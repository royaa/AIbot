import { z } from "zod";

export const ToolKind = z.enum([
  "auto",
  "grok",
  "claude",
  "dsh",
  "cursor",
  "cursor_agent",
  "codex",
  "svn",
  "workbuddy",
  /** 手机手动取文件：prompt 为工作区内相对路径 */
  "file",
]);
export type ToolKind = z.infer<typeof ToolKind>;

export const SvnAction = z.enum([
  "status",
  "update",
  "diff",
  "log",
  "commit",
]);
export type SvnAction = z.infer<typeof SvnAction>;

export const CursorAction = z.enum(["open", "goto", "diff", "launch_desktop"]);
export type CursorAction = z.infer<typeof CursorAction>;

export const TaskStatus = z.enum([
  "queued",
  "running",
  "awaiting_confirm",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const OutputKind = z.enum(["stdout", "stderr", "info", "tool", "markdown"]);
export type OutputKind = z.infer<typeof OutputKind>;

const baseEnvelope = {
  id: z.string().uuid(),
  ts: z.number().int().nonnegative(),
};

export const TaskCreatePayload = z.object({
  taskId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  workspaceId: z.string().min(1),
  tool: ToolKind.default("auto"),
  prompt: z.string().min(1),
  options: z
    .object({
      model: z.string().optional(),
      grokModel: z.string().optional(),
      claudePermissionMode: z.string().optional(),
      dshProfile: z.string().optional(),
      cursorAction: CursorAction.optional(),
      cursorPath: z.string().optional(),
      cursorLine: z.number().int().optional(),
      svnAction: SvnAction.optional(),
      svnMessage: z.string().optional(),
      svnPaths: z.array(z.string()).optional(),
      /** 相对 workspace 根目录的 SVN 工作副本路径，如 admin 或 www/foo */
      svnWorkDir: z.string().optional(),
      force: z.boolean().optional(),
      attachments: z
        .array(
          z.object({
            name: z.string().min(1),
            mimeType: z.string().min(1),
            dataBase64: z.string().min(1),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type TaskCreatePayload = z.infer<typeof TaskCreatePayload>;

export const TaskOutputPayload = z.object({
  taskId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  kind: OutputKind,
  text: z.string(),
  done: z.boolean().optional(),
});
export type TaskOutputPayload = z.infer<typeof TaskOutputPayload>;

export const TaskStatusPayload = z.object({
  taskId: z.string().uuid(),
  status: TaskStatus,
  message: z.string().optional(),
  exitCode: z.number().int().optional(),
});
export type TaskStatusPayload = z.infer<typeof TaskStatusPayload>;

export const TaskConfirmRequestPayload = z.object({
  taskId: z.string().uuid(),
  confirmId: z.string().uuid(),
  title: z.string(),
  detail: z.string(),
  danger: z.boolean().default(true),
});
export type TaskConfirmRequestPayload = z.infer<typeof TaskConfirmRequestPayload>;

export const TaskConfirmResponsePayload = z.object({
  taskId: z.string().uuid(),
  confirmId: z.string().uuid(),
  approved: z.boolean(),
});
export type TaskConfirmResponsePayload = z.infer<typeof TaskConfirmResponsePayload>;

export const TaskCancelPayload = z.object({
  taskId: z.string().uuid(),
});
export type TaskCancelPayload = z.infer<typeof TaskCancelPayload>;

/** 手机重连后向 Relay 拉取断线期间的输出与最终状态 */
export const TaskCatchupPayload = z.object({
  tasks: z
    .array(
      z.object({
        taskId: z.string().uuid(),
        /** 已收到的最大 seq；传 -1 表示从 0 全量回放 */
        afterSeq: z.number().int().min(-1).default(-1),
      }),
    )
    .min(1)
    .max(50),
});
export type TaskCatchupPayload = z.infer<typeof TaskCatchupPayload>;

/** Agent → 手机：文件已上传至 Relay，可经 HTTP 下载（大文件不走 ws） */
export const FileOfferPayload = z.object({
  fileId: z.string().min(1),
  taskId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mimeType: z.string().default("application/octet-stream"),
  sha256: z.string().length(64),
  /** 相对 Relay HTTP 根的下载路径，含一次性 token，如 /files/xxx?t=… */
  url: z.string().min(1),
  /** 下载 token 过期时间（ms 时间戳），与文件 TTL 对齐 */
  expiresAt: z.number().int(),
});
export type FileOfferPayload = z.infer<typeof FileOfferPayload>;

export const ToolModelOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type ToolModelOption = z.infer<typeof ToolModelOption>;

/** 能力归属：cli = 本机 CLI 自带模型/MCP；agent = PC Agent 进程托管 */
export const ToolHostKind = z.enum(["cli", "agent"]);
export type ToolHostKind = z.infer<typeof ToolHostKind>;

/** Agent 下发给 App 的 CLI 目录（增删 CLI 主要改 Agent registry） */
export const ToolCatalogEntry = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** 是否出现在 App 可选目录（含动作类工具） */
  primary: z.boolean().default(false),
  /** 是否展示模型选择 */
  supportsModels: z.boolean().default(false),
  /** 能力归属；缺省按 cli 兼容旧 Agent */
  hostKind: ToolHostKind.default("cli"),
  /** 切换 CLI 时给用户看的能力说明 */
  capabilityNote: z.string().optional(),
  /**
   * 是否可出现在「对话 CLI」选择器。
   * false = 动作类（如取文件），不能当会话工具聊。
   */
  chatSelectable: z.boolean().default(true),
});
export type ToolCatalogEntry = z.infer<typeof ToolCatalogEntry>;

export const SkillCatalogEntry = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
});
export type SkillCatalogEntry = z.infer<typeof SkillCatalogEntry>;

export const AgentStatusPayload = z.object({
  agentId: z.string().uuid(),
  hostname: z.string(),
  online: z.boolean(),
  workspaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
    }),
  ),
  tools: z.record(z.string(), z.string().optional()),
  toolModels: z.record(z.string(), z.array(ToolModelOption)).optional(),
  toolCatalog: z.array(ToolCatalogEntry).optional(),
  /** 当前启用的公共技能摘要 */
  skillsCatalog: z.array(SkillCatalogEntry).optional(),
});
export type AgentStatusPayload = z.infer<typeof AgentStatusPayload>;

export const PairStartPayload = z.object({
  pairCode: z.string().length(8),
  agentId: z.string().uuid(),
  hostname: z.string(),
  expiresAt: z.number().int(),
});
export type PairStartPayload = z.infer<typeof PairStartPayload>;

export const PairCompletePayload = z.object({
  pairCode: z.string().length(8),
  deviceName: z.string().min(1).max(64),
});
export type PairCompletePayload = z.infer<typeof PairCompletePayload>;

export const AuthTokenPayload = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  deviceId: z.string().uuid(),
  agentId: z.string().uuid(),
});
export type AuthTokenPayload = z.infer<typeof AuthTokenPayload>;

export const MessageType = z.enum([
  "hello",
  "pair.start",
  "pair.complete",
  "auth.token",
  "agent.status",
  "task.create",
  "task.output",
  "task.status",
  "task.confirm.request",
  "task.confirm.response",
  "task.cancel",
  "task.catchup",
  "file.offer",
  "error",
]);
export type MessageType = z.infer<typeof MessageType>;

export const Role = z.enum(["mobile", "agent", "relay"]);
export type Role = z.infer<typeof Role>;

function envelope<T extends z.ZodTypeAny>(type: MessageType, payload: T) {
  return z.object({
    ...baseEnvelope,
    type: z.literal(type),
    role: Role,
    payload,
  });
}

export const HelloMessage = envelope("hello", z.object({
  role: Role,
  deviceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  token: z.string().optional(),
  version: z.string().optional(),
}));

export const PairStartMessage = envelope("pair.start", PairStartPayload);
export const PairCompleteMessage = envelope("pair.complete", PairCompletePayload);
export const AuthTokenMessage = envelope("auth.token", AuthTokenPayload);
export const AgentStatusMessage = envelope("agent.status", AgentStatusPayload);
export const TaskCreateMessage = envelope("task.create", TaskCreatePayload);
export const TaskOutputMessage = envelope("task.output", TaskOutputPayload);
export const TaskStatusMessage = envelope("task.status", TaskStatusPayload);
export const TaskConfirmRequestMessage = envelope(
  "task.confirm.request",
  TaskConfirmRequestPayload,
);
export const TaskConfirmResponseMessage = envelope(
  "task.confirm.response",
  TaskConfirmResponsePayload,
);
export const TaskCancelMessage = envelope("task.cancel", TaskCancelPayload);
export const TaskCatchupMessage = envelope("task.catchup", TaskCatchupPayload);
export const FileOfferMessage = envelope("file.offer", FileOfferPayload);
export const ErrorMessage = envelope(
  "error",
  z.object({ code: z.string(), message: z.string() }),
);

export const WireMessage = z.discriminatedUnion("type", [
  HelloMessage,
  PairStartMessage,
  PairCompleteMessage,
  AuthTokenMessage,
  AgentStatusMessage,
  TaskCreateMessage,
  TaskOutputMessage,
  TaskStatusMessage,
  TaskConfirmRequestMessage,
  TaskConfirmResponseMessage,
  TaskCancelMessage,
  TaskCatchupMessage,
  FileOfferMessage,
  ErrorMessage,
]);
export type WireMessage = z.infer<typeof WireMessage>;

export function parseWireMessage(raw: unknown): WireMessage {
  return WireMessage.parse(raw);
}

export function createMessage(
  type: MessageType,
  role: Role,
  payload: Record<string, unknown>,
): WireMessage {
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    type,
    role,
    payload,
  } as WireMessage;
}

/** Dart 模型生成参考：见 shared/protocol/dart/grokbot_protocol.dart */
export const PROTOCOL_VERSION = "0.1.0";

/** Control 通道（PC 客户端 ↔ Agent 本机回环）协议与状态类型 */
export * from "./ctl.js";
