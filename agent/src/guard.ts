import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "./config.js";
import { isAutoApprove } from "./config.js";

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: string; needsConfirm?: boolean; title?: string; detail?: string };

export function checkTask(
  task: TaskCreatePayload,
  cfg?: AgentConfig,
): GuardResult {
  // 手机遥控默认自动放行：不再把确认推给 App
  if (!cfg || isAutoApprove(cfg)) {
    return { ok: true };
  }

  const tool = task.tool;
  const opt = task.options ?? {};

  if (tool === "svn" && opt.svnAction === "commit") {
    const dir = opt.svnWorkDir ? ` @ ${opt.svnWorkDir}` : "";
    return {
      ok: false,
      needsConfirm: true,
      reason: "confirm",
      title: "确认 SVN 提交",
      detail: `目录${dir}，将提交 ${opt.svnPaths?.length ?? "该副本下变更"}，日志: ${opt.svnMessage ?? task.prompt}`,
    };
  }

  if (tool === "claude" && opt.claudePermissionMode === "bypassPermissions") {
    return {
      ok: false,
      needsConfirm: true,
      reason: "confirm",
      title: "Claude 高权限模式",
      detail: "bypassPermissions 可修改文件并执行命令，请确认继续。",
    };
  }

  if (tool === "cursor_agent" && opt.force) {
    return {
      ok: false,
      needsConfirm: true,
      reason: "confirm",
      title: "Cursor Agent 强制模式",
      detail: "将使用 --force，自动批准工具调用。",
    };
  }

  const lower = task.prompt.toLowerCase();
  if (
    /\b(rm\s+-rf|del\s+\/f|format\s+[a-z]:|drop\s+table)\b/i.test(task.prompt) ||
    lower.includes("svn revert")
  ) {
    return {
      ok: false,
      needsConfirm: true,
      reason: "confirm",
      title: "危险操作",
      detail: task.prompt.slice(0, 500),
    };
  }

  return { ok: true };
}
