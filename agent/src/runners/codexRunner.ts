import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { isAutoApprove } from "../config.js";
import { withSkillsPrompt } from "../skills/loader.js";
import { spawnTool, type ChunkHandler, type RunnerResult } from "./spawnUtil.js";

/**
 * 解析 `codex exec --json` 的 JSONL：提取 assistant 文本与 session/thread id。
 */
function createCodexJsonFilter(
  onChunk: ChunkHandler,
  onMeta: (info: { sessionId?: string }) => void,
) {
  let buf = "";
  let emitted = false;

  function handleLine(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("{")) {
      onChunk("stdout", raw + "\n");
      return;
    }
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const sid =
        (typeof j.session_id === "string" && j.session_id) ||
        (typeof j.sessionId === "string" && j.sessionId) ||
        (typeof j.thread_id === "string" && j.thread_id) ||
        (typeof j.threadId === "string" && j.threadId) ||
        (typeof j.id === "string" &&
        (j.type === "thread.started" || j.type === "session.created")
          ? j.id
          : undefined);
      if (sid) onMeta({ sessionId: sid });

      const type = typeof j.type === "string" ? j.type : "";

      // item.completed（含 agent_message / error）
      if (type.includes("agent_message") || type === "item.completed") {
        const item = j.item as {
          type?: string;
          text?: string;
          content?: string;
          message?: string;
        } | undefined;
        const itemType = item?.type ?? "";
        if (itemType === "error") {
          const err =
            (typeof item?.message === "string" && item.message) ||
            (typeof item?.text === "string" && item.text) ||
            "";
          if (err.trim()) onChunk("stderr", err.endsWith("\n") ? err : err + "\n");
          return;
        }
        const text =
          (typeof item?.text === "string" && item.text) ||
          (typeof item?.content === "string" && item.content) ||
          (typeof j.text === "string" && j.text) ||
          "";
        if (text.trim()) {
          emitted = true;
          onChunk("markdown", text.endsWith("\n") ? text : text + "\n");
        }
        return;
      }

      if (type === "message" || type === "assistant") {
        const content = j.content ?? j.text;
        if (typeof content === "string" && content.trim()) {
          emitted = true;
          onChunk("markdown", content.endsWith("\n") ? content : content + "\n");
        }
        return;
      }

      // 最终 result
      if (
        (type === "result" || type === "turn.completed") &&
        typeof j.result === "string" &&
        j.result.trim() &&
        !emitted
      ) {
        emitted = true;
        onChunk("markdown", j.result.endsWith("\n") ? j.result : j.result + "\n");
      }
    } catch {
      onChunk("stdout", raw + "\n");
    }
  }

  return {
    push(text: string) {
      buf += text;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    flush() {
      if (buf.trim()) handleLine(buf);
      buf = "";
    },
  };
}

export async function runCodex(
  cfg: AgentConfig,
  cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
  resumeId?: string,
): Promise<RunnerResult> {
  const codex =
    cfg.tools.codex ??
    "C:\\Users\\luotaiqiang\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
  const auto = isAutoApprove(cfg);
  const model = task.options?.model?.trim();
  const prompt = withSkillsPrompt(cfg, task.prompt);

  const args: string[] = ["exec", "--json", "--skip-git-repo-check", "-C", cwd];
  if (auto) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    // `--approve-for-me` 已隐含 workspace-write，不能再带 `-s`
    args.push("--approve-for-me");
  }
  if (model && model !== "auto" && model !== "default") {
    args.push("-m", model);
  }

  if (resumeId) {
    // codex exec resume <SESSION_ID> [PROMPT]
    args.push("resume", resumeId, prompt);
  } else {
    args.push(prompt);
  }

  let nativeSessionId = resumeId;
  const filter = createCodexJsonFilter(onChunk, (meta) => {
    if (meta.sessionId) nativeSessionId = meta.sessionId;
  });

  const { done } = spawnTool(
    codex,
    args,
    cwd,
    (kind, text) => {
      if (kind === "stderr") onChunk("stderr", text);
      else filter.push(text);
    },
    signal,
  );
  const { exitCode } = await done;
  filter.flush();
  return { exitCode, nativeSessionId };
}
