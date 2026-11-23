import type { TaskCreatePayload, ToolKind } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { getSessionConfig, resolveWorkspace } from "../config.js";
import { dispatchTask, type RunnerResult } from "../runners/index.js";
import type { ChunkHandler } from "../runners/spawnUtil.js";
import {
  resolveToolKind,
  shouldOrchestrateTool,
  supportsNativeResume,
} from "../tools/registry.js";
import { compactConversation } from "./compactor.js";
import { buildInjectedPrompt } from "./contextBuilder.js";
import { loadConversation, saveConversation } from "./conversationStore.js";

export function shouldOrchestrate(task: TaskCreatePayload): boolean {
  return shouldOrchestrateTool(task);
}

function resolvedTool(task: TaskCreatePayload): ToolKind {
  return resolveToolKind(task.tool);
}

/**
 * Agent 会话编排策略：
 * 1. 各 CLI 使用自身的 Agent 架构与工具循环；
 * 2. 同一 session 连续使用同一 CLI：
 *    - 支持原生会话的 CLI（claude / cursor_agent）直接走 --resume <nativeSessionId> + 原始 prompt，零包装、零额外压缩；
 *    - 无原生 --resume 的 CLI（grok / dsh headless）自动携带最近几轮对话（超长才压缩），保证同 session 记忆不断；
 * 3. 同一 session 切换 CLI 时：
 *    - 对较早历史做压缩（超保留轮数/预算时）+ 选取最近几轮对话注入给新 CLI；
 *    - 若新 CLI 支持原生会话，用交接上下文建立新原生会话，后续继续走其原生 --resume。
 */
export async function handleOrchestratedTask(
  cfg: AgentConfig,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const sessionId = task.sessionId!;
  const tool = resolvedTool(task);
  const sessionCfg = getSessionConfig(cfg);
  const ws = resolveWorkspace(cfg, task.workspaceId);
  const conv = loadConversation(sessionId);

  const maxContextChars = sessionCfg.maxContextChars ?? 12000;
  const keepRecentTurns = sessionCfg.keepRecentTurns ?? 6;
  const nativeEnabled =
    sessionCfg.nativeResume?.[tool] !== false && supportsNativeResume(tool);

  const hasPriorHistory =
    conv.turns.length > 0 || conv.summary.trim().length > 0;
  const switchedCli = Boolean(conv.lastTool && conv.lastTool !== tool);
  const canNativeResume =
    nativeEnabled &&
    !switchedCli &&
    Boolean(conv.nativeSessions[tool]);

  let effectivePrompt = task.prompt;
  let resumeId: string | undefined;

  if (!hasPriorHistory) {
    // 新会话首轮：原样发送给目标 CLI，开启其原生 Agent 循环
    effectivePrompt = task.prompt;
    if (nativeEnabled) delete conv.nativeSessions[tool];
  } else if (canNativeResume) {
    // 同 session 同 CLI 原生续接：完全交给 CLI 自己的会话记忆
    effectivePrompt = task.prompt;
    resumeId = conv.nativeSessions[tool];
  } else {
    // 切换了 CLI，或者当前 CLI（grok/dsh）无原生 --resume：
    // 切 CLI 时若轮数超过保留窗口则压缩早期对话，否则直接选取最近几轮发送给新 CLI
    await compactConversation(cfg, conv, sessionCfg, ws.path, {
      forceFoldOlder: switchedCli && conv.turns.length > keepRecentTurns,
    });
    effectivePrompt = buildInjectedPrompt(conv, task.prompt, {
      maxContextChars,
      keepRecentTurns,
      handoffFrom: switchedCli ? conv.lastTool : undefined,
    });
    if (nativeEnabled) {
      delete conv.nativeSessions[tool];
    }
  }

  let assistantBuf = "";
  const wrapChunk: ChunkHandler = (kind, text) => {
    if (kind === "markdown" || kind === "stdout") assistantBuf += text;
    onChunk(kind, text);
  };

  let result = await dispatchTask(
    cfg,
    { ...task, prompt: effectivePrompt, tool },
    wrapChunk,
    signal,
    { resumeId },
  );

  // 原生 --resume 失效自愈：若因本地原生会话被清导致失败且无输出，自动回退用前文新建原生会话重试一次
  if (
    resumeId &&
    result.exitCode !== 0 &&
    !assistantBuf.trim() &&
    !signal?.aborted &&
    hasPriorHistory
  ) {
    delete conv.nativeSessions[tool];
    await compactConversation(cfg, conv, sessionCfg, ws.path);
    const fallbackPrompt = buildInjectedPrompt(conv, task.prompt, {
      maxContextChars,
      keepRecentTurns,
    });
    result = await dispatchTask(
      cfg,
      { ...task, prompt: fallbackPrompt, tool },
      wrapChunk,
      signal,
      {},
    );
  }

  if (result.nativeSessionId && nativeEnabled) {
    conv.nativeSessions[tool] = result.nativeSessionId;
  }

  conv.turns.push({
    role: "user",
    tool,
    text: task.prompt,
    ts: Date.now(),
  });
  conv.turns.push({
    role: "assistant",
    tool,
    text: assistantBuf.trim() || "(无文本输出)",
    ts: Date.now(),
  });
  conv.lastTool = tool;
  saveConversation(conv);

  return result;
}
