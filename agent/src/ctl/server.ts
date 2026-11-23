import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type {
  AgentConfigDto,
  CliInstallTarget,
  CtlFrame,
  LogsTailPayload,
} from "@grokbot/protocol";
import type { AgentCore } from "../core.js";
import type { AgentConfig } from "../config.js";
import { probeCliTools } from "./probe.js";
import { startInstall, getRunningInstall } from "./installer.js";
import { uninstallCli } from "./uninstall.js";
import { getCliConfig, setCliConfig } from "./configWriter.js";

const agentRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(agentRoot, "data");
const ctlFile = path.join(dataDir, "ctl.json");

const AUTH_TIMEOUT_MS = 3000;
const PING_INTERVAL_MS = 30_000;
const MAX_CONNECTIONS = 4;

type Client = { ws: WebSocket; authed: boolean };

/**
 * 本地控制通道：仅监听 127.0.0.1，随机端口 + 随机 token 写入 agent/data/ctl.json。
 * PC 客户端通过该文件发现 Agent 并 attach（无论 Agent 由谁启动）。
 */
export function startControlServer(core: AgentCore) {
  if (process.env.GROKBOT_CTL === "0") {
    core.log("info", "控制通道已通过 GROKBOT_CTL=0 关闭");
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  const clients = new Set<Client>();

  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    maxPayload: 4 * 1024 * 1024,
  });

  const broadcast = (event: string, data: unknown) => {
    const frame: CtlFrame = { kind: "event", event: event as never, data };
    const raw = JSON.stringify(frame);
    for (const c of clients) {
      if (c.authed && c.ws.readyState === WebSocket.OPEN) c.ws.send(raw);
    }
  };

  // 核心事件 → 广播给已认证客户端
  core.addEventListener((e) => {
    if (e.type === "log") {
      broadcast("log", { ts: e.ts, level: e.level, text: e.text });
    } else if (
      e.type === "connection" ||
      e.type === "pairing" ||
      e.type === "task"
    ) {
      broadcast("state", core.getStatus());
    }
  });

  wss.on("listening", () => {
    const addr = wss.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      ctlFile,
      JSON.stringify(
        { port, token, pid: process.pid, startedAt: Date.now() },
        null,
        2,
      ),
    );
    core.log("info", `控制通道已开启: 127.0.0.1:${port}（客户端可 attach）`);
  });

  wss.on("connection", (ws) => {
    if (clients.size >= MAX_CONNECTIONS) {
      ws.close(1013, "too many clients");
      return;
    }
    const client: Client = { ws, authed: false };
    clients.add(client);

    const authTimer = setTimeout(() => {
      if (!client.authed) ws.close(4001, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    ws.on("message", (raw) => {
      let frame: CtlFrame;
      try {
        frame = JSON.parse(raw.toString()) as CtlFrame;
      } catch {
        return;
      }
      if (!client.authed) {
        if (frame.kind === "auth" && frame.token === token) {
          client.authed = true;
          clearTimeout(authTimer);
          const res: CtlFrame = { kind: "res", id: "auth", ok: true, data: null };
          ws.send(JSON.stringify(res));
          // 认证成功即推送当前状态，客户端无需额外请求即可同步
          ws.send(
            JSON.stringify({
              kind: "event",
              event: "state",
              data: core.getStatus(),
            } satisfies CtlFrame),
          );
        } else {
          ws.close(4003, "invalid token");
        }
        return;
      }
      if (frame.kind !== "req") return;
      void handleRequest(core, frame.type, frame.payload, broadcast)
        .then((data) => {
          const res: CtlFrame = { kind: "res", id: frame.id, ok: true, data };
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(res));
        })
        .catch((err) => {
          const res: CtlFrame = {
            kind: "res",
            id: frame.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(res));
        });
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      clients.delete(client);
    });
    ws.on("error", () => clients.delete(client));
  });

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, PING_INTERVAL_MS);

  const cleanup = () => {
    try {
      fs.unlinkSync(ctlFile);
    } catch {
      /* 不存在即忽略 */
    }
  };
  process.on("exit", cleanup);

  const disposeCtl = () => {
    clearInterval(pingTimer);
    cleanup();
    for (const c of clients) c.ws.close(1001, "server shutting down");
    wss.close();
  };
  process.once("SIGINT", () => {
    disposeCtl();
  });
}

// ─── 请求处理 ──────────────────────────────────────────────

function toConfigDto(cfg: AgentConfig): AgentConfigDto {
  return {
    agentId: cfg.agentId,
    relayUrl: cfg.relayUrl,
    tokenPresent: Boolean(cfg.token),
    workspaces: cfg.workspaces,
    tools: cfg.tools,
    session: cfg.session,
    fileOffer: cfg.fileOffer,
    skills: cfg.skills,
    mcp: cfg.mcp,
    autoApprove: cfg.autoApprove,
  };
}

async function handleRequest(
  core: AgentCore,
  type: string,
  payload: unknown,
  broadcast: (event: string, data: unknown) => void,
): Promise<unknown> {
  switch (type) {
    case "status.get":
      return core.getStatus();

    case "config.get":
      return toConfigDto(core.cfg);

    case "config.set": {
      const patch = sanitizeConfigPatch(payload);
      core.applyConfigPatch(patch);
      return toConfigDto(core.cfg);
    }

    case "pair.restart":
      core.restartPairing();
      return { ok: true };

    case "agent.stop":
      // 先回复再退出，客户端收到 res 后由 AgentProcessManager 处理进程退出
      setTimeout(() => {
        core.stop();
        process.exit(0);
      }, 150);
      return { ok: true };

    case "logs.tail": {
      const p = (payload ?? {}) as LogsTailPayload;
      const limit = Math.max(1, Math.min(p.limit ?? 300, 2000));
      return { entries: core.logs.slice(-limit) };
    }

    case "cli.probe": {
      const ids = (payload as { ids?: string[] } | undefined)?.ids;
      return { items: await probeCliTools(core.cfg, ids) };
    }

    case "cli.install": {
      const body = payload as { target?: CliInstallTarget; update?: boolean } | undefined;
      const target = body?.target;
      if (!target) throw new Error("缺少 target");
      return startInstall(core, target, (ev) => {
        if ("line" in ev) broadcast("install.output", ev);
        else broadcast("install.done", ev);
      }, { update: Boolean(body?.update) });
    }

    case "cli.uninstall": {
      const id = (payload as { id?: string } | undefined)?.id?.trim();
      if (!id) throw new Error("缺少 id");
      return uninstallCli(core, id);
    }

    case "cli.config.get": {
      const cli = (payload as { cli?: string })?.cli;
      if (!cli) throw new Error("缺少 cli");
      return getCliConfig(core.cfg, cli);
    }

    case "cli.config.set": {
      const p = payload as { cli?: string } | undefined;
      if (!p?.cli) throw new Error("缺少 cli");
      await setCliConfig(core, p as never);
      return getCliConfig(core.cfg, p.cli);
    }

    case "workspaces.probe": {
      const items = core.cfg.workspaces.map((w) => {
        let resolvedPath = "";
        try {
          resolvedPath = path.resolve(w.path);
        } catch {
          resolvedPath = w.path;
        }
        let exists = false;
        let isDirectory = false;
        let problem: string | undefined;
        try {
          const stat = fs.statSync(resolvedPath);
          exists = true;
          isDirectory = stat.isDirectory();
          if (!isDirectory) problem = "路径存在但不是目录（文件？）";
        } catch {
          problem = "目录不存在（手机下发任务会失败；新建目录或修正路径）";
        }
        return { id: w.id, name: w.name, path: w.path, resolvedPath, exists, isDirectory, problem };
      });
      return { items };
    }

    default:
      throw new Error(`未知请求: ${type}`);
  }
}

/** 只放行客户端可写的配置键；workspaces 做形状校验 */
function sanitizeConfigPatch(payload: unknown): Partial<AgentConfig> {
  if (!payload || typeof payload !== "object") {
    throw new Error("payload 必须是对象");
  }
  const raw = payload as Record<string, unknown>;
  const patch: Partial<AgentConfig> = {};
  if (typeof raw.relayUrl === "string") {
    if (!/^wss?:\/\//i.test(raw.relayUrl.trim())) {
      throw new Error("relayUrl 必须以 ws:// 或 wss:// 开头");
    }
    patch.relayUrl = raw.relayUrl.trim();
  }
  if (Array.isArray(raw.workspaces)) {
    const seen = new Set<string>();
    patch.workspaces = raw.workspaces.map((w) => {
      const item = w as Record<string, unknown>;
      const id = String(item.id ?? "").trim();
      const name = String(item.name ?? "").trim();
      const p = String(item.path ?? "").trim();
      if (!id || !name || !p) throw new Error("工作区 id/name/path 均不能为空");
      if (seen.has(id)) throw new Error(`工作区 id 重复: ${id}`);
      seen.add(id);
      return { id, name, path: p };
    });
  }
  if (raw.tools && typeof raw.tools === "object" && !Array.isArray(raw.tools)) {
    /** 全量替换语义：客户端回传完整 tools 表（剔除兼容用 __ 前缀字段） */
    const tools: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.tools as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      if (k.startsWith("__")) continue;
      tools[k] = v;
    }
    patch.tools = tools;
  }
  if (typeof raw.autoApprove === "boolean") patch.autoApprove = raw.autoApprove;
  if (raw.session && typeof raw.session === "object") {
    patch.session = raw.session as AgentConfig["session"];
  }
  if (raw.fileOffer && typeof raw.fileOffer === "object") {
    patch.fileOffer = raw.fileOffer as AgentConfig["fileOffer"];
  }
  if (raw.skills && typeof raw.skills === "object") {
    patch.skills = raw.skills as AgentConfig["skills"];
  }
  if (raw.mcp && typeof raw.mcp === "object") {
    patch.mcp = raw.mcp as AgentConfig["mcp"];
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("没有可识别的配置项");
  }
  return patch;
}
