import type { Conversation } from "./conversationStore.js";

export type ContextBuildOptions = {
  maxContextChars: number;
  keepRecentTurns: number;
  handoffFrom?: string;
};

export function buildInjectedPrompt(
  conv: Conversation,
  userMessage: string,
  opts: ContextBuildOptions,
): string {
  const hasSummary = conv.summary.trim().length > 0;
  const recent = conv.turns.slice(-opts.keepRecentTurns);

  // 首轮或无任何前文时，直接发送原始指令，不破坏 CLI 原生语义
  if (!hasSummary && recent.length === 0) {
    return userMessage;
  }

  const buildWithRecent = (turnsSlice: typeof recent, perTurnCap: number) => {
    const sections: string[] = [];
    const headerNote = opts.handoffFrom
      ? `以下是同一会话此前在 ${opts.handoffFrom} 中的上下文，请在此基础上继续完成【当前用户指令】（使用你自身的工具与 Agent 能力，无需重复已完成工作）：`
      : "以下是同一会话的前序上下文，请在此基础上继续完成【当前用户指令】：";
    sections.push(headerNote);

    if (hasSummary) {
      sections.push("【前文压缩摘要】\n" + conv.summary.trim());
    }

    if (turnsSlice.length > 0) {
      const lines: string[] = ["【最近对话记录】"];
      for (const t of turnsSlice) {
        const who = t.role === "user" ? "用户" : `助手(${t.tool})`;
        const body =
          t.text.length > perTurnCap
            ? t.text.slice(0, perTurnCap) + "…"
            : t.text;
        lines.push(`${who}: ${body}`);
      }
      sections.push(lines.join("\n\n"));
    }

    sections.push("【当前用户指令】\n" + userMessage);
    return sections.join("\n\n---\n\n");
  };

  let prompt = buildWithRecent(recent, 2000);

  while (prompt.length > opts.maxContextChars && recent.length > 2) {
    recent.shift();
    prompt = buildWithRecent(recent, 1500);
  }

  if (prompt.length > opts.maxContextChars) {
    prompt =
      (hasSummary
        ? `【前文压缩摘要】\n${conv.summary.trim().slice(-4000)}\n\n---\n\n`
        : "") +
      "【当前用户指令】\n" +
      userMessage;
  }

  return prompt;
}
