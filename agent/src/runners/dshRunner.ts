import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { withSkillsPrompt } from "../skills/loader.js";
import { spawnTool, type ChunkHandler, type RunnerResult } from "./spawnUtil.js";

export async function runDsh(
  cfg: AgentConfig,
  cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const dsh = cfg.tools.dsh ?? "dsh";
  const profile = task.options?.dshProfile ?? "headless";
  const args = ["--profile", profile, withSkillsPrompt(cfg, task.prompt)];
  const { done } = spawnTool(dsh, args, cwd, onChunk, signal);
  const { exitCode } = await done;
  return { exitCode };
}

export async function launchDshDesktop(
  cfg: AgentConfig,
  onChunk: ChunkHandler,
): Promise<number> {
  const exe = cfg.tools.dshDesktop;
  if (!exe) {
    onChunk("stderr", "未配置 dshDesktop 路径\n");
    return 1;
  }
  const { done } = spawnTool(exe, [], process.cwd(), onChunk);
  const { exitCode } = await done;
  return exitCode;
}
