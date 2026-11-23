import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { isAutoApprove } from "../config.js";
import { getMcpConfig, writeClaudeRuntimeMcpConfig } from "../mcp/sync.js";
import { loadSkillsText } from "../skills/loader.js";
import { createStreamJsonLineProcessor } from "./streamJsonText.js";
import { spawnTool, type ChunkHandler, type RunnerResult } from "./spawnUtil.js";

export async function runClaude(
  cfg: AgentConfig,
  cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
  resumeId?: string,
): Promise<RunnerResult> {
  const claude = cfg.tools.claude ?? "claude";
  const model = task.options?.model?.trim();
  const auto = isAutoApprove(cfg);
  // 手机遥控默认跳过交互授权；仅当 autoApprove=false 时才尊重显式 permissionMode
  const perm = auto
    ? "bypassPermissions"
    : task.options?.claudePermissionMode;

  const skillsText = loadSkillsText(cfg);
  const args = [
    "-p",
    task.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (skillsText.trim()) {
    args.push("--append-system-prompt", skillsText);
  }
  // 公共 MCP：任务级注入，不依赖本机 Claude 是否已重启
  if (getMcpConfig(cfg).injectClaude !== false) {
    try {
      const mcpPath = writeClaudeRuntimeMcpConfig();
      if (mcpPath) args.push("--mcp-config", mcpPath);
    } catch (e) {
      onChunk(
        "info",
        `[mcp] Claude --mcp-config 注入失败: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }
  if (auto) {
    // 新版 Claude Code：先允许再启用跳过权限，避免非交互挂起等待授权
    args.push("--allow-dangerously-skip-permissions");
    args.push("--dangerously-skip-permissions");
  } else if (perm) {
    args.push("--permission-mode", perm);
  }
  if (model && model !== "auto" && model !== "default") {
    args.push("--model", model);
  }
  if (resumeId) args.push("--resume", resumeId);

  let nativeSessionId = resumeId;
  const parser = createStreamJsonLineProcessor(
    (display) => onChunk("markdown", display),
    (k, line) => onChunk(k, line),
    (meta) => {
      if (meta.sessionId) nativeSessionId = meta.sessionId;
    },
  );

  const { done } = spawnTool(
    claude,
    args,
    cwd,
    (kind, text) => {
      if (kind === "stderr") {
        onChunk("stderr", text);
      } else {
        parser.push(text);
      }
    },
    signal,
  );
  const { exitCode } = await done;
  parser.flush();
  return { exitCode, nativeSessionId };
}
