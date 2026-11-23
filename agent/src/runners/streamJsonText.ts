/**
 * 从 Claude / Cursor Agent 的 stream-json 行提取可读文本，
 * 支持跨 data 分片行缓冲，并避免 partial delta / assistant 汇总 / result 重复输出。
 */
export function createStreamJsonLineProcessor(
  onChunk: (display: string) => void,
  onRaw?: (kind: "stdout" | "stderr", line: string) => void,
  onMeta?: (info: { sessionId?: string }) => void,
) {
  let buffer = "";
  let emittedAnyText = false;
  let sawPartialAssistant = false;

  function processSingleLine(rawLine: string) {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    if (!trimmed.startsWith("{")) {
      onRaw?.("stdout", rawLine + "\n");
      return;
    }

    let j: Record<string, unknown>;
    try {
      j = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      onRaw?.("stdout", rawLine + "\n");
      return;
    }

    const sid =
      j.session_id ?? j.sessionId ?? j.chatId ?? j.thread_id ?? j.threadId;
    if (typeof sid === "string" && sid.length > 0) {
      onMeta?.({ sessionId: sid });
    }

    const t = j.type as string | undefined;

    if (t === "assistant" && j.message && typeof j.message === "object") {
      const msg = j.message as { content?: unknown };
      const text = extractAnthropicContent(msg.content);
      const isPartialDelta = typeof j.timestamp_ms === "number";
      if (isPartialDelta) {
        if (text) {
          sawPartialAssistant = true;
          emittedAnyText = true;
          onChunk(text);
        }
      } else {
        if (!sawPartialAssistant && text) {
          emittedAnyText = true;
          onChunk(text.endsWith("\n") ? text : text + "\n");
        }
        // 一条完整 assistant 消息结束后重置，以便后续工具调用后的下一段回复继续流式输出
        sawPartialAssistant = false;
      }
      return;
    }

    if (t === "content_block_delta") {
      const delta = j.delta as { text?: string } | undefined;
      if (delta?.text) {
        sawPartialAssistant = true;
        emittedAnyText = true;
        onChunk(delta.text);
      }
      return;
    }

    if (t === "content_block_start") {
      const block = j.content_block as { text?: string } | undefined;
      if (block?.text) {
        sawPartialAssistant = true;
        emittedAnyText = true;
        onChunk(block.text);
      }
      return;
    }

    if (t === "text" && typeof j.text === "string" && j.text) {
      emittedAnyText = true;
      onChunk(j.text);
      return;
    }

    if (t === "result") {
      if (j.is_error === true && typeof j.result === "string" && j.result) {
        onRaw?.("stderr", j.result + "\n");
      } else if (!emittedAnyText && typeof j.result === "string" && j.result) {
        emittedAnyText = true;
        onChunk(j.result.endsWith("\n") ? j.result : j.result + "\n");
      }
      return;
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processSingleLine(line);
      }
    },
    flush() {
      if (buffer.trim()) {
        processSingleLine(buffer);
      }
      buffer = "";
    },
  };
}

function extractAnthropicContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let out = "";
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && b.text) out += b.text;
    }
  }
  return out.length > 0 ? out : null;
}

/** 兼容单次调用接口 */
export function handleStreamJsonLines(
  text: string,
  onChunk: (display: string) => void,
  onRaw?: (kind: "stdout" | "stderr", line: string) => void,
  onMeta?: (info: { sessionId?: string }) => void,
) {
  const proc = createStreamJsonLineProcessor(onChunk, onRaw, onMeta);
  proc.push(text);
  proc.flush();
}
