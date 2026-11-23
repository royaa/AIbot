import crypto from "node:crypto";
import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig, SessionConfig } from "../config.js";
import { runClaude } from "../runners/claudeRunner.js";
import { runGrok } from "../runners/grokRunner.js";
import {
  estimateConversationChars,
  saveConversation,
  type Conversation,
  type ConversationTurn,
} from "./conversationStore.js";

function fallbackTruncateSummary(existingSummary: string, folded: ConversationTurn[]): string {
  const highlights = folded
    .map((t) => {
      const who = t.role === "user" ? "用户" : `助手(${t.tool})`;
      const snippet = t.text.replace(/\s+/g, " ").trim().slice(0, 240);
      return `- ${who}: ${snippet}${t.text.length > 240 ? "…" : ""}`;
    })
    .join("\n");
  const merged = [existingSummary.trim(), "（早期对话要点）\n" + highlights]
    .filter(Boolean)
    .join("\n\n");
  return merged.length > 4000 ? merged.slice(-4000) : merged;
}

/**
 * 仅在需要跨 CLI 交接或无原生会话工具超预算时调用：
 * 将 keepRecentTurns 之前的轮次压缩进 conv.summary，保留最近几轮原话。
 */
export async function compactConversation(
  cfg: AgentConfig,
  conv: Conversation,
  sessionCfg: SessionConfig,
  workspacePath: string,
  opts?: { forceFoldOlder?: boolean },
): Promise<void> {
  const budget = sessionCfg.maxContextChars ?? 12000;
  const keep = sessionCfg.keepRecentTurns ?? 6;

  if (conv.turns.length <= keep) return;
  if (!opts?.forceFoldOlder && estimateConversationChars(conv) <= budget) {
    return;
  }

  const toFold = conv.turns.slice(0, Math.max(0, conv.turns.length - keep));
  if (toFold.length === 0) return;

  const transcript = [
    conv.summary.trim() ? `【已有摘要】\n${conv.summary.trim()}` : "",
    ...toFold.map((t) => {
      const who = t.role === "user" ? "用户" : `助手(${t.tool})`;
      return `${who}: ${t.text.slice(0, 2500)}`;
    }),
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt =
    "请将以下编程助手对话历史压缩为简洁中文摘要（控制在 600 字以内），保留关键目标、已修改的文件/路径、重要结论与待办事项。只输出摘要正文，不要调用任何工具。\n\n" +
    transcript;

  const summarizeTool = sessionCfg.summarizeTool ?? "grok";
  let summaryText = "";

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 35_000);
  try {
    const fakeTask: TaskCreatePayload = {
      taskId: crypto.randomUUID(),
      workspaceId: cfg.workspaces[0]?.id ?? "grokbot",
      tool: summarizeTool === "claude" ? "claude" : "grok",
      prompt,
    };
    let buf = "";
    const collect = (k: string, text: string) => {
      if (k === "markdown" || k === "stdout") buf += text;
    };
    const res =
      summarizeTool === "claude"
        ? await runClaude(cfg, workspacePath, fakeTask, collect, ac.signal)
        : await runGrok(cfg, workspacePath, fakeTask, collect, ac.signal);
    if (res.exitCode === 0 && buf.trim()) {
      summaryText = buf.trim();
    }
  } catch {
    /* 回退本地提要截断 */
  } finally {
    clearTimeout(timer);
  }

  if (summaryText) {
    conv.summary = summaryText;
  } else {
    conv.summary = fallbackTruncateSummary(conv.summary, toFold);
  }
  conv.turns = conv.turns.slice(-keep);
  saveConversation(conv);
}
