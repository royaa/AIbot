import crypto from "node:crypto";
import WebSocket from "ws";
import {
  createMessage,
  parseWireMessage,
  type AgentConnectionState,
  type AgentLogLevel,
  type AgentStatus,
  type LogEntry,
  type PairingInfo,
  type RunningTaskInfo,
  type AuthTokenPayload,
  type TaskConfirmResponsePayload,
  type TaskCreatePayload,
  type ToolModelOption,
  type WireMessage,
} from "@grokbot/protocol";
import { audit } from "./audit.js";
import { materializeAttachments } from "./attachments.js";
import {
  hostname,
  loadConfig,
  resolveWorkspace,
  saveLocalConfig,
  type AgentConfig,
} from "./config.js";
import { autoPushArtifacts, setOfferSender } from "./filePush.js";
import { checkTask } from "./guard.js";
import { dispatchTask } from "./runners/index.js";
import type { ChunkHandler } from "./runners/spawnUtil.js";
import {
  handleOrchestratedTask,
  shouldOrchestrate,
} from "./session/orchestrator.js";
import { autoSyncMcpOnStartup } from "./mcp/sync.js";
import { installedRegistryIds } from "./ctl/probe.js";
import { buildSkillsCatalog } from "./skills/loader.js";
import {
  buildToolCatalog,
  discoverAllRegisteredToolModels,
  primaryToolCatalog,
} from "./tools/registry.js";

export const AGENT_VERSION = "0.1.0";

export type {
  AgentLogLevel,
  AgentConnectionState,
  PairingInfo,
  LogEntry,
  RunningTaskInfo,
  AgentStatus,
} from "@grokbot/protocol";

export type AgentEvent =
  | { type: "log"; ts: number; level: AgentLogLevel; text: string }
  | {
      type: "connection";
      state: AgentConnectionState;
      detail?: string;
      relayUrl?: string;
    }
  | { type: "pairing"; info: PairingInfo | null }
  | { type: "task"; taskId: string; status: string; tool?: string };

export type AgentCoreOptions = {
  /** `npm run agent:pair` → 每次连上 Relay 都发布配对码 */
  pairMode?: boolean;
  onEvent?: (e: AgentEvent) => void;
};

const LOG_BUFFER_MAX = 2000;
const PENDING_MAX = 8000;
const RECONNECT_DELAY_MS = 5000;
const STATUS_INTERVAL_MS = 12_000;

/**
 * Agent 服务核心：管理 Relay 连接、任务执行、配对。
 * 与宿主解耦——CLI 模式由 index.ts 适配 console 输出，
 * 客户端模式经 ControlServer（ctl/server.ts）暴露状态与控制。
 */
export class AgentCore {
  cfg: AgentConfig;
  pairMode: boolean;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  /** 最近日志环形缓冲（ctl logs.tail / 客户端日志页用） */
  readonly logs: LogEntry[] = [];
  private startedAt = 0;
  private stopped = true;
  private connectionState: AgentConnectionState = "stopped";
  private connectDetail: string | undefined;
  private currentPairing: PairingInfo | null = null;
  private pairingExpireTimer: ReturnType<typeof setTimeout> | undefined;

  private activeWs: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private statusTimer: ReturnType<typeof setInterval> | undefined;
  private skipAutoReconnectOnce = false;

  /** 断线期间缓冲任务相关消息，重连后刷到新 WS */
  private pendingOutbound: WireMessage[] = [];
  private pendingConfirms = new Map<
    string,
    { resolve: (ok: boolean) => void; task: TaskCreatePayload }
  >();
  private running = new Map<
    string,
    { ac: AbortController; tool: string; startedAt: number }
  >();
  private cachedToolModels: Record<string, ToolModelOption[]> = {};

  constructor(opts: AgentCoreOptions = {}) {
    this.cfg = loadConfig();
    this.pairMode = opts.pairMode ?? false;
    if (opts.onEvent) this.listeners.add(opts.onEvent);
    setOfferSender((msg) => this.sendActive(msg, true));
  }

  // ─── 事件与日志 ───────────────────────────────────────────

  /** 订阅核心事件（ControlServer 等附加宿主用）；返回取消订阅函数 */
  addEventListener(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: AgentEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* 单个监听者异常不影响核心 */
      }
    }
  }

  log(level: AgentLogLevel, text: string) {
    const entry: LogEntry = { ts: Date.now(), level, text };
    this.logs.push(entry);
    while (this.logs.length > LOG_BUFFER_MAX) this.logs.shift();
    this.emit({ type: "log", ...entry });
  }

  private setState(
    state: AgentConnectionState,
    detail?: string,
    relayUrl?: string,
  ) {
    this.connectionState = state;
    this.connectDetail = detail;
    this.emit({ type: "connection", state, detail, relayUrl });
  }

  private setPairing(info: PairingInfo | null) {
    this.currentPairing = info;
    if (this.pairingExpireTimer) clearTimeout(this.pairingExpireTimer);
    this.pairingExpireTimer = undefined;
    if (info) {
      this.pairingExpireTimer = setTimeout(() => {
        if (this.currentPairing?.pairCode === info.pairCode) {
          this.currentPairing = null;
          this.emit({ type: "pairing", info: null });
        }
      }, Math.max(0, info.expiresAt - Date.now()));
    }
    this.emit({ type: "pairing", info });
  }

  // ─── 出站消息 ─────────────────────────────────────────────

  private send(ws: WebSocket | undefined, msg: WireMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  /** 任务输出/状态始终走当前连接；断线时入队，避免重连后丢片 */
  private sendActive(msg: WireMessage, bufferIfOffline = false) {
    if (this.send(this.activeWs, msg)) return;
    if (!bufferIfOffline) return;
    if (
      msg.type === "task.output" ||
      msg.type === "task.status" ||
      msg.type === "task.confirm.request" ||
      msg.type === "file.offer"
    ) {
      this.pendingOutbound.push(msg);
      while (this.pendingOutbound.length > PENDING_MAX)
        this.pendingOutbound.shift();
    }
  }

  private flushPending() {
    while (
      this.pendingOutbound.length > 0 &&
      this.activeWs?.readyState === WebSocket.OPEN
    ) {
      const msg = this.pendingOutbound.shift()!;
      this.send(this.activeWs, msg);
    }
  }

  // ─── 生命周期 ─────────────────────────────────────────────

  start() {
    this.stopped = false;
    this.startedAt = Date.now();
    autoSyncMcpOnStartup(this.cfg);

    if (this.pairMode) {
      this.log(
        "info",
        "【配对模式 agent:pair】连上 Relay 后强制显示二维码/8 位码（与是否已有 token 无关）",
      );
    } else if (this.cfg.token) {
      this.log(
        "info",
        "【正常模式】已加载本地 token，不显示配对码。手机需重新配对：npm run agent:pair",
      );
    } else {
      this.log(
        "info",
        "【正常模式】无 token，连上 Relay 后将自动显示配对码",
      );
    }
    this.log(
      "info",
      `AI Bot Agent ${this.cfg.agentId} @ ${hostname()} → ${this.cfg.relayUrl}`,
    );

    this.connect();
    void this.discoverModels();
  }

  /** 停止服务：断开 Relay、终止任务、清理定时器（进程是否退出由宿主决定） */
  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = undefined;
    if (this.pairingExpireTimer) clearTimeout(this.pairingExpireTimer);
    for (const [, t] of this.running) t.ac.abort();
    this.pendingConfirms.clear();
    this.skipAutoReconnectOnce = true;
    this.activeWs?.close(1000, "agent stopped");
    this.activeWs = undefined;
    this.setState("stopped");
  }

  /** 强制重新进入配对模式并立即重连（客户端「重新配对」按钮） */
  restartPairing() {
    this.pairMode = true;
    this.log("info", "已切换到配对模式，重连后将发布新配对码");
    this.forceReconnect(300);
  }

  /** 立即断开并按新配置重连（改 relayUrl/token 后调用） */
  private forceReconnect(delay = 300) {
    if (this.stopped) return;
    this.skipAutoReconnectOnce = true;
    this.activeWs?.close(1000, "reconnect requested");
    this.activeWs = undefined;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = undefined;
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delay = RECONNECT_DELAY_MS) {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  /**
   * 热更新配置：写 local.json + 内存生效。
   * workspaces/tools/autoApprove/skills/mcp/fileOffer/session 立即生效；
   * relayUrl/token 变化会触发重连。
   */
  applyConfigPatch(partial: Partial<AgentConfig>) {
    const reconnectKeys: (keyof AgentConfig)[] = ["relayUrl", "token"];
    const needsReconnect = reconnectKeys.some(
      (k) =>
        partial[k] !== undefined &&
        (partial as Record<string, unknown>)[k] !==
          (this.cfg as unknown as Record<string, unknown>)[k],
    );
    saveLocalConfig(partial);
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) continue;
      if (k === "tools" && v && typeof v === "object" && !Array.isArray(v)) {
        // 与 loadConfig 的合并语义一致：tools 按 key 浅合并，避免全量替换遮蔽新键
        this.cfg.tools = { ...this.cfg.tools, ...(v as Record<string, string>) };
      } else {
        (this.cfg as unknown as Record<string, unknown>)[k] = v;
      }
    }
    if (this.currentPairing && needsReconnect) this.setPairing(null);
    if (needsReconnect) this.forceReconnect(300);
    this.log("info", "配置已更新（热生效）");
  }

  /** 安装脚本等外部进程改写 agent.config.json 后，从磁盘重载合并 */
  reloadFromDisk() {
    const fresh = loadConfig();
    Object.assign(this.cfg, fresh);
    this.log("info", "已从磁盘重载配置");
  }

  getStatus(): AgentStatus {
    return {
      agentId: this.cfg.agentId,
      hostname: hostname(),
      relayUrl: this.cfg.relayUrl,
      connectionState: this.connectionState,
      connectDetail: this.connectDetail,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      pairMode: this.pairMode,
      tokenPresent: Boolean(this.cfg.token),
      currentPairing: this.currentPairing,
      runningTasks: [...this.running.entries()].map(([taskId, t]) => ({
        taskId,
        tool: t.tool,
        startedAt: t.startedAt,
      })),
      version: AGENT_VERSION,
    };
  }

  // ─── 模型发现 ─────────────────────────────────────────────

  private async discoverModels() {
    try {
      const models = await discoverAllRegisteredToolModels(this.cfg);
      this.cachedToolModels = models;
      const summary = Object.entries(models)
        .map(([k, list]) => `${k}=${list.length}`)
        .join(", ");
      if (summary) {
        this.log("info", `已探测可选模型: ${summary}`);
      }
      if (this.activeWs?.readyState === WebSocket.OPEN) {
        this.publishStatus(this.activeWs);
      }
    } catch (e) {
      this.log(
        "warn",
        `模型探测失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ─── 配对 ─────────────────────────────────────────────────

  private pairCode(): string {
    return crypto.randomBytes(4).toString("hex").toUpperCase();
  }

  private shouldShowPairing() {
    return this.pairMode || !this.cfg.token;
  }

  private async showPairing(ws: WebSocket) {
    const code = this.pairCode();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const qrPayload = JSON.stringify({
      pairCode: code,
      agentId: this.cfg.agentId,
      relayUrl: this.cfg.relayUrl,
    });
    this.send(
      ws,
      createMessage("pair.start", "agent", {
        pairCode: code,
        agentId: this.cfg.agentId,
        hostname: hostname(),
        expiresAt,
      }),
    );
    this.log("info", "\n=== AI Bot PC Agent 配对 ===");
    this.log("info", `配对码: ${code}`);
    this.log("info", `Agent ID: ${this.cfg.agentId}`);
    this.log("info", `Relay: ${this.cfg.relayUrl}`);
    this.setPairing({
      pairCode: code,
      agentId: this.cfg.agentId,
      relayUrl: this.cfg.relayUrl,
      expiresAt,
      qrPayload,
    });
  }

  // ─── 状态上报 ─────────────────────────────────────────────

  /** 安装/卸载后让已连接的手机立刻拿到新的 CLI 列表 */
  notifyToolsChanged() {
    if (this.activeWs?.readyState === WebSocket.OPEN) this.publishStatus(this.activeWs);
  }

  private publishStatus(ws: WebSocket) {
    const hasModels = Object.keys(this.cachedToolModels).length > 0;
    const installed = installedRegistryIds(this.cfg);
    const catalog = buildToolCatalog(installed);
    const primary = primaryToolCatalog(installed);
    const skillsCatalog = buildSkillsCatalog(this.cfg);
    const safeTools: Record<string, string | undefined> = { ...this.cfg.tools };
    delete safeTools.grokApiKey;
    if (hasModels) {
      // 兼容未升级 schema 的中转服务器：同时放在 tools.__models_json 与 toolModels
      safeTools.__models_json = JSON.stringify(this.cachedToolModels);
    }
    // 兼容旧 Relay：catalog 同时塞进 tools 字符串字段
    safeTools.__catalog_json = JSON.stringify(primary);
    if (skillsCatalog.length > 0) {
      safeTools.__skills_json = JSON.stringify(skillsCatalog);
    }
    this.send(
      ws,
      createMessage("agent.status", "agent", {
        agentId: this.cfg.agentId,
        hostname: hostname(),
        online: true,
        workspaces: this.cfg.workspaces,
        tools: safeTools,
        toolCatalog: catalog,
        skillsCatalog,
        ...(hasModels ? { toolModels: this.cachedToolModels } : {}),
      }),
    );
  }

  // ─── 任务执行 ─────────────────────────────────────────────

  private emitTask(taskId: string, status: string, tool?: string) {
    this.emit({ type: "task", taskId, status, tool });
  }

  private async runTask(task: TaskCreatePayload) {
    let execTask = task;
    let workspacePath: string | undefined;
    try {
      const wsPath = resolveWorkspace(this.cfg, task.workspaceId).path;
      workspacePath = wsPath;
      execTask = materializeAttachments(task, wsPath);
    } catch (e) {
      this.sendActive(
        createMessage("task.status", "agent", {
          taskId: task.taskId,
          status: "failed",
          message: e instanceof Error ? e.message : String(e),
        }),
        true,
      );
      this.emitTask(task.taskId, "failed", task.tool);
      return;
    }

    const guard = checkTask(execTask, this.cfg);
    if (!guard.ok && guard.needsConfirm) {
      const confirmId = crypto.randomUUID();
      this.sendActive(
        createMessage("task.status", "agent", {
          taskId: task.taskId,
          status: "awaiting_confirm",
          message: guard.title,
        }),
        true,
      );
      this.sendActive(
        createMessage("task.confirm.request", "agent", {
          taskId: task.taskId,
          confirmId,
          title: guard.title ?? "确认",
          detail: guard.detail ?? guard.reason,
          danger: true,
        }),
        true,
      );
      const approved = await new Promise<boolean>((resolve) => {
        this.pendingConfirms.set(confirmId, { resolve, task: execTask });
        setTimeout(() => {
          if (this.pendingConfirms.has(confirmId)) {
            this.pendingConfirms.delete(confirmId);
            resolve(false);
          }
        }, 120_000);
      });
      if (!approved) {
        this.sendActive(
          createMessage("task.status", "agent", {
            taskId: task.taskId,
            status: "cancelled",
            message: "用户未确认",
          }),
          true,
        );
        this.emitTask(task.taskId, "cancelled", task.tool);
        return;
      }
    } else if (!guard.ok) {
      this.sendActive(
        createMessage("task.status", "agent", {
          taskId: task.taskId,
          status: "failed",
          message: guard.reason,
        }),
        true,
      );
      this.emitTask(task.taskId, "failed", task.tool);
      return;
    }

    const ac = new AbortController();
    this.running.set(task.taskId, {
      ac,
      tool: execTask.tool,
      startedAt: Date.now(),
    });
    let seq = 0;
    const taskStartedAt = Date.now();
    this.sendActive(
      createMessage("task.status", "agent", {
        taskId: task.taskId,
        status: "running",
      }),
      true,
    );
    this.emitTask(task.taskId, "running", execTask.tool);
    audit("task.start", {
      taskId: task.taskId,
      tool: task.tool,
      prompt: task.prompt,
    });

    try {
      const onChunk: ChunkHandler = (kind, text) => {
        this.sendActive(
          createMessage("task.output", "agent", {
            taskId: task.taskId,
            seq: seq++,
            kind:
              kind === "markdown"
                ? "markdown"
                : kind === "stdout"
                  ? "stdout"
                  : kind === "stderr"
                    ? "stderr"
                    : "info",
            text,
          }),
          true,
        );
      };

      const result = shouldOrchestrate(execTask)
        ? await handleOrchestratedTask(this.cfg, execTask, onChunk, ac.signal)
        : await dispatchTask(this.cfg, execTask, onChunk, ac.signal);
      const exitCode = result.exitCode;
      const status = ac.signal.aborted
        ? "cancelled"
        : exitCode === 0
          ? "completed"
          : "failed";
      this.sendActive(
        createMessage("task.status", "agent", {
          taskId: task.taskId,
          status,
          exitCode,
          ...(status === "cancelled" ? { message: "已停止" } : {}),
        }),
        true,
      );
      this.emitTask(task.taskId, status, execTask.tool);
      audit("task.end", { taskId: task.taskId, exitCode, status });
      // 任务成功后自动推送工作区内新产物（默认任意层级 .apk）；「取文件」工具已自带推送
      if (status === "completed" && execTask.tool !== "file" && workspacePath) {
        void autoPushArtifacts(
          this.cfg,
          task,
          workspacePath,
          taskStartedAt,
          onChunk,
        ).catch(() => {});
      }
    } catch (e) {
      this.sendActive(
        createMessage("task.status", "agent", {
          taskId: task.taskId,
          status: ac.signal.aborted ? "cancelled" : "failed",
          message: e instanceof Error ? e.message : String(e),
        }),
        true,
      );
      this.emitTask(task.taskId, ac.signal.aborted ? "cancelled" : "failed", execTask.tool);
    } finally {
      this.running.delete(task.taskId);
    }
  }

  // ─── Relay 连接 ───────────────────────────────────────────

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.cfg.relayUrl);
    this.activeWs = ws;
    this.setState("connecting", undefined, this.cfg.relayUrl);
    let statusTimer: ReturnType<typeof setInterval> | undefined;

    ws.on("open", () => {
      this.setState("connected", undefined, this.cfg.relayUrl);
      this.log("info", "已连接 Relay");
      this.send(
        ws,
        createMessage("hello", "agent", {
          role: "agent",
          agentId: this.cfg.agentId,
          token: this.cfg.token || undefined,
          version: AGENT_VERSION,
        }),
      );
      if (this.shouldShowPairing()) {
        void this.showPairing(ws);
      } else {
        this.log(
          "info",
          "已使用本地 token，跳过配对码（手机重新配对请用 npm run agent:pair）",
        );
      }
      this.publishStatus(ws);
      this.flushPending();
      if (this.running.size > 0) {
        this.log(
          "info",
          `重连后继续上报 ${this.running.size} 个进行中任务的输出`,
        );
      }
      statusTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) this.publishStatus(ws);
      }, STATUS_INTERVAL_MS);
      this.statusTimer = statusTimer;
    });

    ws.on("message", (data) => {
      let msg;
      try {
        msg = parseWireMessage(JSON.parse(data.toString()));
      } catch {
        return;
      }
      if (msg.type === "error") {
        const p = msg.payload as { code?: string; message?: string };
        if (p.code === "auth") {
          this.log("error", `Relay 鉴权失败: ${p.message ?? "Invalid token"}`);
          this.log(
            "error",
            "已清除本地 token，将重新进入配对（请用手机 App 输入新配对码）",
          );
          saveLocalConfig({ token: "" });
          this.cfg.token = "";
          if (ws.readyState === WebSocket.OPEN) void this.showPairing(ws);
        }
      }
      if (msg.type === "auth.token") {
        const p = msg.payload as AuthTokenPayload;
        if (p.accessToken) {
          saveLocalConfig({ token: p.accessToken });
          this.cfg.token = p.accessToken;
          this.setPairing(null);
          this.log("info", "已保存 agent token");
          this.flushPending();
        }
      }
      if (msg.type === "task.create") {
        void this.runTask(msg.payload as TaskCreatePayload);
      }
      if (msg.type === "task.cancel") {
        const taskId = (msg.payload as { taskId: string }).taskId;
        const entry = this.running.get(taskId);
        if (entry) {
          entry.ac.abort();
          this.log("info", `收到停止: ${taskId}`);
        } else {
          // 任务已不在本机运行（已完成/丢状态），仍回 cancelled 让 App 清 UI
          this.sendActive(
            createMessage("task.status", "agent", {
              taskId,
              status: "cancelled",
              message: "任务不在运行",
            }),
            true,
          );
        }
      }
      if (msg.type === "task.confirm.response") {
        const p = msg.payload as TaskConfirmResponsePayload;
        const pending = this.pendingConfirms.get(p.confirmId);
        if (pending) {
          this.pendingConfirms.delete(p.confirmId);
          pending.resolve(p.approved);
        }
      }
    });

    ws.on("close", (code, reason) => {
      if (this.activeWs === ws) this.activeWs = undefined;
      if (this.statusTimer === statusTimer) {
        if (statusTimer) clearInterval(statusTimer);
        this.statusTimer = undefined;
      }
      const hint =
        this.cfg.token && code === 1005
          ? "（若反复出现，请删除 agent.config.local.json 中的 token 后重启）"
          : "";
      const detail = `Relay 断开 (${code})`;
      this.log("info", `${detail}，5 秒后重连…${hint}`);
      if (this.pairMode) {
        this.log("info", "配对模式：重连成功后会再次显示二维码/配对码");
      }
      if (this.running.size > 0) {
        this.log(
          "info",
          `仍有 ${this.running.size} 个任务在本地执行，输出将在重连后补发`,
        );
      }
      if (this.stopped) {
        return;
      }
      if (this.skipAutoReconnectOnce) {
        this.skipAutoReconnectOnce = false;
        this.setState("disconnected", detail);
        return;
      }
      this.setState("disconnected", detail);
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      const detail = `WS error: ${err.message}`;
      this.log("error", detail);
      if (err.message.includes("301")) {
        this.log(
          "error",
          "提示：Relay 返回 301，多为 HTTP 被重定向到 HTTPS。请用 ws:// 时重新部署 Relay（关闭 Certbot 301），或改用 wss://",
        );
      }
      this.setState("disconnected", detail, this.cfg.relayUrl);
    });
  }
}
