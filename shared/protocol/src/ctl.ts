/**
 * Control 通道协议（PC 客户端 ↔ Agent，仅本机回环 ws://127.0.0.1）
 *
 * 发现方式：读取 agent/data/ctl.json → { port, token, pid }
 * 握手：连接后 3 秒内首条消息必须是 { kind: "auth", token }，否则服务端关闭连接。
 */

// ─── Agent 状态（status.get / state 事件） ───────────────────

export type AgentLogLevel = "info" | "warn" | "error";

/** stopped=核心已停止；connecting/connected/disconnected 为 Relay 连接生命周期 */
export type AgentConnectionState =
  | "stopped"
  | "connecting"
  | "connected"
  | "disconnected";

export type PairingInfo = {
  pairCode: string;
  agentId: string;
  relayUrl: string;
  expiresAt: number;
  /** 手机扫码用 JSON payload（客户端自行渲染二维码） */
  qrPayload: string;
};

export type LogEntry = { ts: number; level: AgentLogLevel; text: string };

export type RunningTaskInfo = {
  taskId: string;
  tool: string;
  startedAt: number;
};

export type AgentStatus = {
  agentId: string;
  hostname: string;
  relayUrl: string;
  connectionState: AgentConnectionState;
  connectDetail?: string;
  startedAt: number;
  uptimeMs: number;
  pairMode: boolean;
  tokenPresent: boolean;
  currentPairing: PairingInfo | null;
  runningTasks: RunningTaskInfo[];
  version: string;
};

// ─── 配置 DTO（与 agent/src/config.ts 的 AgentConfig 保持同步） ──

export type WorkspaceDto = { id: string; name: string; path: string };

export type SessionConfigDto = {
  maxContextChars?: number;
  keepRecentTurns?: number;
  summarizeTool?: string;
  nativeResume?: Record<string, boolean>;
};

export type FileOfferConfigDto = {
  enabled?: boolean;
  patterns?: string[];
  excludeDirs?: string[];
  maxFiles?: number;
  maxFileMb?: number;
};

export type SkillsConfigDto = {
  enabled?: boolean;
  include?: string[];
  exclude?: string[];
};

export type McpConfigDto = {
  autoSync?: boolean;
  injectClaude?: boolean;
};

export type AgentConfigDto = {
  agentId: string;
  relayUrl: string;
  /** 只回传是否已配置的布尔，不给客户端明文 token */
  tokenPresent?: boolean;
  workspaces: WorkspaceDto[];
  tools: Record<string, string>;
  session?: SessionConfigDto;
  fileOffer?: FileOfferConfigDto;
  skills?: SkillsConfigDto;
  mcp?: McpConfigDto;
  autoApprove?: boolean;
};

// ─── CLI 探测 / 安装 / 配置 ─────────────────────────────────

export type CliProbeItem = {
  /** registry 工具 id */
  id: string;
  label: string;
  /** 对应 agent.config 的 tools.* 键 */
  cfgKey: string;
  /** 配置的原始值（可能为空） */
  configured: string;
  /** 解析后的绝对路径（PATH 中的裸命令会被解析） */
  resolved?: string;
  installed: boolean;
  version?: string;
  /** 登录提示（登录动作无法自动化，客户端展示指引） */
  loginHint?: string;
  probeError?: string;
};

export type CliInstallTarget =
  | "all"
  | "claude"
  | "cursorAgent"
  | "codex"
  | "workbuddy"
  | "opencode"
  | "pi"
  | "droid"
  | "crush";

export type CliInstallStartAck = {
  started: boolean;
  alreadyRunning?: { target: CliInstallTarget; startedAt: number };
};

export type CliInstallOutputEvent = {
  target: CliInstallTarget;
  stream: "stdout" | "stderr";
  line: string;
  ts: number;
};

export type CliInstallDoneEvent = {
  target: CliInstallTarget;
  exitCode: number;
  ok: boolean;
};

export type CliConfigTarget = "grok" | "claude" | "codex" | "opencode" | "pi" | "droid" | "crush";

export type CliConfigView =
  | {
      cli: "grok";
      apiKey: string;
      baseUrl: string;
      /** 值来源：env / agentConfig / cliFile / none */
      apiKeySource: "env" | "agentConfig" | "cliFile" | "none";
    }
  | {
      cli: "claude";
      baseUrl: string;
      authToken: string;
      /** 写入位置 ~/.claude/settings.json → env */
      settingsPath: string;
      baseUrlSource: "env" | "cliFile" | "none";
    }
  | {
      cli: "codex";
      baseUrl: string;
      apiKey: string;
      /** 写入位置 ~/.codex/config.toml（+ ~/.codex/models.json 模型目录） */
      configPath: string;
      providerId?: string;
    }
  | {
      cli: "opencode";
      baseUrl: string;
      apiKey: string;
      /** 端点覆盖写 ~/.config/opencode/opencode.json；密钥写 ~/.local/share/opencode/auth.json */
      configFile: string;
      authFile: string;
      providerId: string;
    }
  | {
      cli: "pi";
      apiKey: string;
      /** zai-coding-cn provider 端点内建不可改；密钥经环境变量注入（ZAI_CODING_CN_API_KEY） */
      envKey: string;
      /** 交互式登录：pi 内执行 /login zai-coding-cn */
      loginCommand: string;
    }
  | {
      cli: "droid";
      baseUrl: string;
      apiKey: string;
      model: string;
      /** 写入位置 ~/.factory/settings.json → customModels[]（BYOK） */
      configFile: string;
      provider: string;
    }
  | {
      cli: "crush";
      baseUrl: string;
      apiKey: string;
      /** 写入位置 ~/.config/crush/crush.json → providers.zai */
      configFile: string;
      providerId: string;
    };

export type CliConfigSetPayload =
  | { cli: "grok"; apiKey?: string; baseUrl?: string }
  | { cli: "claude"; baseUrl?: string; authToken?: string }
  | { cli: "codex"; baseUrl?: string; apiKey?: string }
  | { cli: "opencode"; baseUrl?: string; apiKey?: string }
  | { cli: "pi"; apiKey?: string }
  | { cli: "droid"; baseUrl?: string; apiKey?: string; model?: string }
  | { cli: "crush"; baseUrl?: string; apiKey?: string };

// ─── 帧格式 ────────────────────────────────────────────────

export type CtlRequestType =
  | "status.get"
  | "config.get"
  | "config.set"
  | "pair.restart"
  | "agent.stop"
  | "logs.tail"
  | "cli.probe"
  | "cli.install"
  | "cli.config.get"
  | "cli.config.set"
  | "workspaces.probe";

// ─── 工作区探测（workspaces.probe） ─────────────────────────

export type WorkspaceProbeItem = {
  id: string;
  name: string;
  path: string;
  /** 规范化后的绝对路径 */
  resolvedPath: string;
  exists: boolean;
  isDirectory: boolean;
  /** exists=false 时的原因描述 */
  problem?: string;
};

export type WorkspacesProbeResult = { items: WorkspaceProbeItem[] };

export type CtlEventName =
  | "log"
  | "state"
  | "pairing"
  | "task"
  | "install.output"
  | "install.done"
  | "config.changed";

export type CtlFrame =
  | { kind: "auth"; token: string }
  | { kind: "req"; id: string; type: CtlRequestType; payload?: unknown }
  | { kind: "res"; id: string; ok: true; data: unknown }
  | { kind: "res"; id: string; ok: false; error: string }
  | { kind: "event"; event: CtlEventName; data: unknown };

export type CtlDiscovery = {
  port: number;
  token: string;
  pid: number;
  startedAt: number;
};

export type LogsTailPayload = { limit?: number };
export type LogsTailResult = { entries: LogEntry[] };
