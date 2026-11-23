import path from "node:path";
import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { assertPathInWorkspace, isAutoApprove } from "../config.js";
import { withSkillsPrompt } from "../skills/loader.js";
import { cursorAgentProxyEnv } from "./proxyEnv.js";
import { spawnTool, type ChunkHandler, type RunnerResult } from "./spawnUtil.js";
import { createStreamJsonLineProcessor } from "./streamJsonText.js";

export async function runCursor(
  cfg: AgentConfig,
  workspacePath: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const cursor = cfg.tools.cursor ?? "cursor";
  const action = task.options?.cursorAction ?? "open";
  let args: string[] = [];

  switch (action) {
    case "open":
      args = [workspacePath];
      break;
    case "goto": {
      const rel = task.options?.cursorPath ?? task.prompt;
      const file = path.resolve(workspacePath, rel);
      assertPathInWorkspace(workspacePath, file);
      const line = task.options?.cursorLine ?? 1;
      args = ["-g", `${file}:${line}`];
      break;
    }
    case "diff": {
      const parts = task.prompt.split("|").map((s) => s.trim());
      if (parts.length < 2) {
        onChunk("stderr", "diff 需要在 prompt 中用 | 分隔两个文件路径\n");
        return { exitCode: 1 };
      }
      const a = path.resolve(workspacePath, parts[0]);
      const b = path.resolve(workspacePath, parts[1]);
      assertPathInWorkspace(workspacePath, a);
      assertPathInWorkspace(workspacePath, b);
      args = ["--diff", a, b];
      break;
    }
    default:
      args = [workspacePath];
  }

  onChunk(
    "info",
    `正在 PC 上启动 Cursor（${action}）…\n工作区: ${workspacePath}\n`,
  );
  const { done } = spawnTool(cursor, args, workspacePath, onChunk, signal, {
    detachedGui: true,
  });
  const { exitCode } = await done;
  return { exitCode };
}

export async function runCursorAgent(
  cfg: AgentConfig,
  cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
  resumeId?: string,
): Promise<RunnerResult> {
  const agentCli = cfg.tools.agent ?? "agent";
  const trust =
    cfg.tools.cursorAgentTrust !== "false" && cfg.tools.cursorAgentTrust !== "0";
  const auto = isAutoApprove(cfg);
  const force = auto || task.options?.force === true;
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    withSkillsPrompt(cfg, task.prompt),
  ];
  if (trust || auto) args.push("--trust");
  // 手机遥控默认 --force/--yolo，避免工具调用卡在「等待授权」
  if (force) args.push("--force");
  const model = task.options?.model?.trim();
  if (model && model !== "auto" && model !== "default") {
    args.push("--model", model);
  }
  if (resumeId) args.push("--resume", resumeId);

  const env = await cursorAgentProxyEnv();
  let nativeSessionId = resumeId;

  const runOnce = async (): Promise<{ exitCode: number; sawText: boolean; stderr: string }> => {
    let sawText = false;
    let stderr = "";
    const parser = createStreamJsonLineProcessor(
      (display) => {
        if (display.trim()) sawText = true;
        onChunk("markdown", display);
      },
      (k, line) => {
        if (k === "stderr") stderr += line;
        else onChunk("stdout", line);
      },
      (meta) => {
        if (meta.sessionId) nativeSessionId = meta.sessionId;
      },
    );
    const { done } = spawnTool(
      agentCli,
      args,
      cwd,
      (kind, text) => {
        if (kind === "stderr") stderr += text;
        else parser.push(text);
      },
      signal,
      { env },
    );
    const { exitCode } = await done;
    parser.flush();
    return { exitCode, sawText, stderr };
  };

  let result = await runOnce();
  // 首包 TLS 被重置时 CLI 只吐 Error unavailable，再试一次通常就能连上
  if (result.exitCode !== 0 && !result.sawText && !signal?.aborted) {
    onChunk("info", "Cursor Agent 连接中断，正在重试…\n");
    result = await runOnce();
  }
  if (result.stderr.trim()) onChunk("stderr", result.stderr);
  return { exitCode: result.exitCode, nativeSessionId };
}
