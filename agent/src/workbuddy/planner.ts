import type { AgentConfig } from "../config.js";
import { spawnTool } from "../runners/spawnUtil.js";

export type WbAction =
  | { action: "click"; ref: string; thought?: string }
  | { action: "type"; ref: string; text: string; submit?: boolean; thought?: string }
  | { action: "press"; key: string; thought?: string }
  | { action: "scroll"; direction: "up" | "down"; thought?: string }
  | { action: "wait"; ms?: number; thought?: string }
  | { action: "navigate"; url: string; thought?: string }
  | { action: "done"; message: string; thought?: string }
  | { action: "fail"; message: string; thought?: string }
  | { action: "need_login"; message: string; thought?: string };

function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("planner 未返回 JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeAction(j: Record<string, unknown>): WbAction {
  const action = String(j.action ?? "").toLowerCase();
  const thought = typeof j.thought === "string" ? j.thought : undefined;
  switch (action) {
    case "click":
      return { action: "click", ref: String(j.ref ?? ""), thought };
    case "type":
      return {
        action: "type",
        ref: String(j.ref ?? ""),
        text: String(j.text ?? ""),
        submit: Boolean(j.submit),
        thought,
      };
    case "press":
      return { action: "press", key: String(j.key ?? "Enter"), thought };
    case "scroll":
      return {
        action: "scroll",
        direction: j.direction === "up" ? "up" : "down",
        thought,
      };
    case "wait":
      return { action: "wait", ms: Number(j.ms ?? 1200), thought };
    case "navigate":
      return { action: "navigate", url: String(j.url ?? ""), thought };
    case "done":
      return { action: "done", message: String(j.message ?? "完成"), thought };
    case "need_login":
      return {
        action: "need_login",
        message: String(j.message ?? "请在本机 Chrome 完成 WorkBuddy 登录"),
        thought,
      };
    case "fail":
      return { action: "fail", message: String(j.message ?? "失败"), thought };
    default:
      throw new Error(`未知 action: ${action}`);
  }
}

export async function planNextAction(
  cfg: AgentConfig,
  opts: {
    goal: string;
    brief: string;
    elementsJson: string;
    history: string;
    signal?: AbortSignal;
  },
): Promise<WbAction> {
  const claude = cfg.tools.claude ?? "claude";
  const prompt = `你是 WorkBuddy Web（https://workbuddy.cn/app）浏览器操作代理。
根据页面信息，为用户目标选择【下一步】唯一动作。只输出一个 JSON 对象，不要 Markdown。

允许的 action：
- click: {"action":"click","ref":"e3","thought":"..."}
- type: {"action":"type","ref":"e5","text":"...","submit":false,"thought":"..."}
- press: {"action":"press","key":"Enter","thought":"..."}
- scroll: {"action":"scroll","direction":"down","thought":"..."}
- wait: {"action":"wait","ms":1500,"thought":"..."}
- navigate: {"action":"navigate","url":"https://workbuddy.cn/app/...","thought":"..."}
- done: {"action":"done","message":"结果摘要","thought":"..."}
- need_login: {"action":"need_login","message":"请用户在 PC Chrome 登录","thought":"..."}
- fail: {"action":"fail","message":"原因","thought":"..."}

规则：
1. ref 必须来自元素列表；不要编造。
2. 若页面明显要求登录且无法继续，用 need_login。
3. 目标已达成用 done，并给出中文摘要。
4. 一次只做一步，优先可推进目标的操作。
5. 不要做危险操作（改密码、绑卡、支付）——若需要则 fail。

用户目标：
${opts.goal}

页面摘要：
${opts.brief}

可交互元素 JSON：
${opts.elementsJson}

已执行步骤：
${opts.history || "(无)"}
`;

  let stdout = "";
  let stderr = "";
  const { done } = spawnTool(
    claude,
    [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
    ],
    process.cwd(),
    (kind, text) => {
      if (kind === "stdout") stdout += text;
      else stderr += text;
    },
    opts.signal,
  );
  const { exitCode } = await done;
  const raw = stdout.trim() || stderr.trim();
  if (!raw) {
    throw new Error(`Claude 规划失败（exit=${exitCode}）：无输出`);
  }
  try {
    return normalizeAction(extractJson(raw) as Record<string, unknown>);
  } catch (e) {
    throw new Error(
      `解析规划 JSON 失败: ${e instanceof Error ? e.message : String(e)}\n原始输出: ${raw.slice(0, 500)}`,
    );
  }
}
