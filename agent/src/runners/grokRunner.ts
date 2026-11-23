import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { withSkillsPrompt } from "../skills/loader.js";
import { spawnTool, type ChunkHandler, type RunnerResult } from "./spawnUtil.js";

/**
 * 解析 grok -p 输出的逐行 OpenAI 消息 JSON：
 * 忽略 user 回显与大段 tool 原始返回，提取 assistant 文本输出。
 */
function createGrokOutputFilter(onChunk: ChunkHandler) {
  let buf = "";

  function handleLine(rawLine: string) {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("{")) {
      onChunk("stdout", rawLine + "\n");
      return;
    }
    try {
      const msg = JSON.parse(trimmed) as {
        role?: string;
        content?: unknown;
      };
      if (msg.role === "user" || msg.role === "tool") {
        return;
      }
      if (msg.role === "assistant") {
        if (typeof msg.content === "string" && msg.content.trim()) {
          const text = msg.content.endsWith("\n")
            ? msg.content
            : msg.content + "\n";
          onChunk("markdown", text);
        }
        return;
      }
      onChunk("stdout", rawLine + "\n");
    } catch {
      onChunk("stdout", rawLine + "\n");
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

/** 智谱 Coding 接口没有 grok-* 模型，空选或旧的 grok 模型名都落到 glm-5.3。 */
const ZHIPU_DEFAULT_MODEL = "glm-5.3";

function resolveGrokModel(requested: string, baseUrl: string): string {
  const onZhipu = /bigmodel\.cn/i.test(baseUrl);
  const unset = !requested || requested === "auto" || requested === "default";
  if (onZhipu && (unset || requested.startsWith("grok-"))) return ZHIPU_DEFAULT_MODEL;
  if (unset) return "";
  return requested;
}

export async function runGrok(
  cfg: AgentConfig,
  cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const grok = cfg.tools.grok ?? "grok";
  const args: string[] = [];
  const apiKey = (cfg.tools.grokApiKey ?? process.env.GROK_API_KEY ?? "").trim();
  const baseUrl = (cfg.tools.grokBaseUrl ?? process.env.GROK_BASE_URL ?? "").trim();
  if (apiKey) args.push("--api-key", apiKey);
  if (baseUrl) args.push("--base-url", baseUrl);
  const model = resolveGrokModel(
    (task.options?.grokModel ?? task.options?.model ?? "").trim(),
    baseUrl,
  );
  if (model) args.push("-m", model);
  args.push("-d", cwd, "-p", withSkillsPrompt(cfg, task.prompt));

  const filter = createGrokOutputFilter(onChunk);
  const { done } = spawnTool(
    grok,
    args,
    cwd,
    (kind, text) => {
      if (kind === "stderr") {
        onChunk("stderr", text);
      } else {
        filter.push(text);
      }
    },
    signal,
  );
  const { exitCode } = await done;
  filter.flush();
  return { exitCode };
}
