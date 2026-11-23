import type { TaskCreatePayload, ToolKind } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { resolveWorkspace } from "../config.js";
import {
  getToolDefinition,
  resolveToolKind,
} from "../tools/registry.js";
import type { ChunkHandler } from "./spawnUtil.js";
import type { RunnerResult } from "./spawnUtil.js";

export type { RunnerResult } from "./spawnUtil.js";

export type DispatchOptions = {
  resumeId?: string;
};

/** App「自动」默认工具（见 registry.AUTO_DEFAULT_TOOL） */
export function resolveDefaultTool(tool: ToolKind): ToolKind {
  return resolveToolKind(tool);
}

export async function dispatchTask(
  cfg: AgentConfig,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
  opts?: DispatchOptions,
): Promise<RunnerResult> {
  const ws = resolveWorkspace(cfg, task.workspaceId);
  const tool = resolveToolKind(task.tool);
  const def = getToolDefinition(tool);
  if (!def) {
    onChunk("stderr", `不支持的工具: ${tool}\n`);
    return { exitCode: 1 };
  }
  return def.run(cfg, ws.path, { ...task, tool }, onChunk, signal, opts?.resumeId);
}
