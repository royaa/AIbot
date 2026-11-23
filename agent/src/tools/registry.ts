import type {
  TaskCreatePayload,
  ToolCatalogEntry,
  ToolHostKind,
  ToolKind,
  ToolModelOption,
} from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import {
  discoverClaudeModels,
  discoverCodexModels,
  discoverCursorAgentModels,
  discoverGrokModels,
} from "../modelDiscovery.js";
import { runClaude } from "../runners/claudeRunner.js";
import { runCodex } from "../runners/codexRunner.js";
import { runCursor, runCursorAgent } from "../runners/cursorRunner.js";
import { launchDshDesktop, runDsh } from "../runners/dshRunner.js";
import { runGrok } from "../runners/grokRunner.js";
import { runFile } from "../runners/fileRunner.js";
import type { ChunkHandler, RunnerResult } from "../runners/spawnUtil.js";
import { runSvn } from "../runners/svnRunner.js";
import { runWorkbuddy } from "../runners/workbuddyRunner.js";

export type ToolRunner = (
  cfg: AgentConfig,
  cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
  resumeId?: string,
) => Promise<RunnerResult>;

export type ToolDefinition = {
  id: Exclude<ToolKind, "auto">;
  label: string;
  /** App 主菜单展示；false = 仅保留执行兼容 */
  primary: boolean;
  supportsModels: boolean;
  conversational: boolean;
  nativeResume: boolean;
  /** cli = 本机 CLI；agent = Agent 进程托管 */
  hostKind: ToolHostKind;
  capabilityNote: string;
  /** 是否可出现在 App 对话 CLI 选择器（false=动作类如取文件） */
  chatSelectable: boolean;
  run: ToolRunner;
  discoverModels?: (
    cfg: AgentConfig,
  ) => Promise<ToolModelOption[]> | ToolModelOption[];
  /** 返回 true 时跳过会话编排，直接 dispatch */
  skipOrchestrate?: (task: TaskCreatePayload) => boolean;
};

const NOTE_CLI = "模型与 MCP 由本机该 CLI 配置决定；公共技能会自动注入";
const NOTE_AGENT = "由 PC Agent 直接执行，与当前对话 CLI / MCP 无关";

/** `auto` 实际落到的 CLI；改默认只改这里 */
export const AUTO_DEFAULT_TOOL: Exclude<ToolKind, "auto"> = "claude";

/**
 * CLI 注册表：新增/下架主入口优先改这里。
 * - primary: false → App 菜单隐藏，但仍可执行（旧客户端/兼容）
 * - 协议 ToolKind 仍需包含 id（wire 校验）
 */
export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    id: "claude",
    label: "Claude",
    primary: true,
    supportsModels: true,
    conversational: true,
    nativeResume: true,
    hostKind: "cli",
    capabilityNote: NOTE_CLI,
    chatSelectable: true,
    run: (cfg, cwd, task, onChunk, signal, resumeId) =>
      runClaude(cfg, cwd, task, onChunk, signal, resumeId),
    discoverModels: (cfg) => discoverClaudeModels(cfg),
  },
  {
    id: "cursor_agent",
    label: "Cursor Agent",
    primary: true,
    supportsModels: true,
    conversational: true,
    nativeResume: true,
    hostKind: "cli",
    capabilityNote: NOTE_CLI,
    chatSelectable: true,
    run: (cfg, cwd, task, onChunk, signal, resumeId) =>
      runCursorAgent(cfg, cwd, task, onChunk, signal, resumeId),
    discoverModels: (cfg) => discoverCursorAgentModels(cfg),
  },
  {
    id: "codex",
    label: "Codex",
    primary: true,
    supportsModels: true,
    conversational: true,
    nativeResume: true,
    hostKind: "cli",
    capabilityNote: NOTE_CLI,
    chatSelectable: true,
    run: (cfg, cwd, task, onChunk, signal, resumeId) =>
      runCodex(cfg, cwd, task, onChunk, signal, resumeId),
    discoverModels: () => discoverCodexModels(),
  },
  {
    id: "workbuddy",
    label: "WorkBuddy",
    primary: true,
    supportsModels: false,
    conversational: true,
    nativeResume: false,
    hostKind: "agent",
    capabilityNote: NOTE_AGENT,
    chatSelectable: true,
    run: (cfg, cwd, task, onChunk, signal) =>
      runWorkbuddy(cfg, cwd, task, onChunk, signal),
  },
  {
    id: "grok",
    label: "Grok",
    primary: false,
    supportsModels: true,
    conversational: true,
    nativeResume: false,
    hostKind: "cli",
    capabilityNote: NOTE_CLI,
    chatSelectable: true,
    run: (cfg, cwd, task, onChunk, signal) =>
      runGrok(cfg, cwd, task, onChunk, signal),
    discoverModels: (cfg) => discoverGrokModels(cfg),
  },
  {
    id: "dsh",
    label: "DSH",
    primary: false,
    supportsModels: false,
    conversational: true,
    nativeResume: false,
    hostKind: "cli",
    capabilityNote: "弱工具链 CLI；复杂 MCP 能力请改用 Claude / Cursor Agent",
    chatSelectable: true,
    skipOrchestrate: (task) =>
      task.options?.dshProfile === "desktop" ||
      task.prompt.trim().toLowerCase() === "launch desktop",
    run: async (cfg, cwd, task, onChunk, signal) => {
      if (
        task.options?.dshProfile === "desktop" ||
        task.prompt.trim().toLowerCase() === "launch desktop"
      ) {
        const code = await launchDshDesktop(cfg, onChunk);
        return { exitCode: code };
      }
      return runDsh(cfg, cwd, task, onChunk, signal);
    },
  },
  {
    id: "cursor",
    label: "Cursor IDE",
    primary: false,
    supportsModels: false,
    conversational: false,
    nativeResume: false,
    hostKind: "cli",
    capabilityNote: "仅打开本机 Cursor IDE，不走对话编排",
    chatSelectable: false,
    run: (cfg, cwd, task, onChunk, signal) =>
      runCursor(cfg, cwd, task, onChunk, signal),
  },
  {
    id: "svn",
    label: "SVN",
    primary: false,
    supportsModels: false,
    conversational: false,
    nativeResume: false,
    hostKind: "agent",
    capabilityNote: NOTE_AGENT,
    chatSelectable: false,
    run: async (cfg, cwd, task, onChunk, signal) => {
      const code = await runSvn(cfg, cwd, task, onChunk, signal);
      return { exitCode: code };
    },
  },
  {
    id: "file",
    label: "取文件",
    /** 动作类：不进对话 CLI 菜单；自动推送 APK 仍可用 */
    primary: false,
    supportsModels: false,
    conversational: false,
    nativeResume: false,
    hostKind: "agent",
    capabilityNote: NOTE_AGENT,
    chatSelectable: false,
    run: (cfg, cwd, task, onChunk) => runFile(cfg, cwd, task, onChunk),
  },
];

const byId = new Map(TOOL_REGISTRY.map((t) => [t.id, t]));

export function getToolDefinition(
  id: string,
): ToolDefinition | undefined {
  return byId.get(id as Exclude<ToolKind, "auto">);
}

export function resolveToolKind(tool: ToolKind): Exclude<ToolKind, "auto"> {
  return tool === "auto" ? AUTO_DEFAULT_TOOL : tool;
}

export function shouldOrchestrateTool(task: TaskCreatePayload): boolean {
  if (!task.sessionId) return false;
  const tool = resolveToolKind(task.tool);
  const def = getToolDefinition(tool);
  if (!def?.conversational) return false;
  if (def.skipOrchestrate?.(task)) return false;
  return true;
}

export function supportsNativeResume(tool: string): boolean {
  return getToolDefinition(tool)?.nativeResume === true;
}

export function supportsModelSelection(tool: string): boolean {
  const id = tool === "auto" ? AUTO_DEFAULT_TOOL : tool;
  return getToolDefinition(id)?.supportsModels === true;
}

function toCatalogEntry(
  id: string,
  label: string,
  primary: boolean,
  supportsModels: boolean,
  hostKind: ToolHostKind,
  capabilityNote: string,
  chatSelectable: boolean,
): ToolCatalogEntry {
  return {
    id,
    label,
    primary,
    supportsModels,
    hostKind,
    capabilityNote,
    chatSelectable,
  };
}

/**
 * App 菜单。传入 installed 时，只把本机已安装的对话 CLI 标成可选，
 * 未安装的不进手机列表；取文件等动作类仍保留。
 */
export function buildToolCatalog(installed?: ReadonlySet<string>): ToolCatalogEntry[] {
  const defaultLabel = getToolDefinition(AUTO_DEFAULT_TOOL)?.label ?? AUTO_DEFAULT_TOOL;
  const entries: ToolCatalogEntry[] = [];
  if (!installed || installed.has(AUTO_DEFAULT_TOOL)) {
    entries.push(
      toCatalogEntry(
        "auto",
        `自动 (${defaultLabel})`,
        true,
        false,
        "cli",
        `自动落到 ${defaultLabel}；模型与 MCP 仍由该 CLI 决定`,
        true,
      ),
    );
  }
  for (const t of TOOL_REGISTRY) {
    const chatCli = t.chatSelectable && (t.hostKind === "cli" || t.id === "workbuddy");
    if (installed && chatCli && !installed.has(t.id)) continue;
    entries.push(
      toCatalogEntry(
        t.id,
        t.label,
        chatCli ? true : t.primary,
        t.supportsModels,
        t.hostKind,
        t.capabilityNote,
        t.chatSelectable,
      ),
    );
  }
  return entries;
}

export function primaryToolCatalog(installed?: ReadonlySet<string>): ToolCatalogEntry[] {
  return buildToolCatalog(installed).filter((e) => e.primary && e.chatSelectable);
}

/** 按注册表探测各 CLI 模型列表 */
export async function discoverAllRegisteredToolModels(
  cfg: AgentConfig,
): Promise<Record<string, ToolModelOption[]>> {
  const result: Record<string, ToolModelOption[]> = {};
  await Promise.all(
    TOOL_REGISTRY.map(async (t) => {
      if (!t.discoverModels) return;
      try {
        const list = await t.discoverModels(cfg);
        if (list.length > 0) result[t.id] = list;
      } catch {
        /* 单个 CLI 探测失败不影响其它 */
      }
    }),
  );
  return result;
}
