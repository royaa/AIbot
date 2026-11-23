import type { Page } from "playwright-core";
import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { ensureWorkbuddyPage, workbuddyUrl } from "../workbuddy/chrome.js";
import {
  annotateInteractive,
  looksLikeLogin,
  pageBrief,
  WB_REF_ATTR,
} from "../workbuddy/dom.js";
import { planNextAction, type WbAction } from "../workbuddy/planner.js";
import type { ChunkHandler, RunnerResult } from "./spawnUtil.js";

const MAX_STEPS = 28;
const LOGIN_WAIT_MS = 5 * 60_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function waitForLogin(
  page: Page,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
): Promise<boolean> {
  const start = Date.now();
  onChunk(
    "markdown",
    "检测到可能需要登录。请在本机弹出的 Chrome 窗口中打开并登录 **WorkBuddy**，登录完成后我会自动继续。\n\n（最长等待约 5 分钟）\n",
  );
  while (Date.now() - start < LOGIN_WAIT_MS) {
    if (signal?.aborted) return false;
    try {
      await sleep(4000, signal);
    } catch {
      return false;
    }
    const brief = await pageBrief(page);
    if (!looksLikeLogin(page.url(), brief)) {
      onChunk("markdown", "已检测到登录态，继续执行任务。\n");
      return true;
    }
    onChunk("info", `仍在等待登录… ${Math.round((Date.now() - start) / 1000)}s\n`);
  }
  return false;
}

async function applyAction(page: Page, act: WbAction): Promise<string> {
  switch (act.action) {
    case "click": {
      const loc = page.locator(`[${WB_REF_ATTR}="${act.ref}"]`).first();
      await loc.click({ timeout: 12_000 });
      return `click ${act.ref}`;
    }
    case "type": {
      const loc = page.locator(`[${WB_REF_ATTR}="${act.ref}"]`).first();
      await loc.click({ timeout: 12_000 });
      await loc.fill(act.text, { timeout: 12_000 });
      if (act.submit) await page.keyboard.press("Enter");
      return `type ${act.ref} «${act.text.slice(0, 40)}»`;
    }
    case "press": {
      await page.keyboard.press(act.key);
      return `press ${act.key}`;
    }
    case "scroll": {
      await page.mouse.wheel(0, act.direction === "up" ? -900 : 900);
      return `scroll ${act.direction}`;
    }
    case "wait": {
      await sleep(Math.min(Math.max(act.ms ?? 1200, 300), 8000));
      return `wait ${act.ms ?? 1200}ms`;
    }
    case "navigate": {
      const url = act.url.startsWith("http") ? act.url : new URL(act.url, page.url()).toString();
      if (!url.includes("workbuddy.cn")) {
        throw new Error(`拒绝导航到非 WorkBuddy 域名: ${url}`);
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      return `navigate ${url}`;
    }
    default:
      return act.action;
  }
}

export async function runWorkbuddy(
  cfg: AgentConfig,
  _cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const goal = task.prompt.trim();
  if (!goal) {
    onChunk("stderr", "任务内容为空\n");
    return { exitCode: 1 };
  }

  try {
    const { page } = await ensureWorkbuddyPage(cfg, (msg) =>
      onChunk("markdown", `${msg}\n`),
    );

    let brief = await pageBrief(page);
    if (looksLikeLogin(page.url(), brief)) {
      const ok = await waitForLogin(page, onChunk, signal);
      if (!ok) {
        onChunk(
          "markdown",
          "\n> 等待登录超时。请在 PC 上登录 WorkBuddy 后，用手机再发一次同样指令。\n",
        );
        return { exitCode: 1 };
      }
    }

    onChunk("markdown", `开始执行 WorkBuddy 任务：${goal}\n`);
    const history: string[] = [];

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal?.aborted) {
        onChunk("markdown", "\n> 已停止\n");
        return { exitCode: 1 };
      }

      await sleep(400, signal).catch(() => undefined);
      const elements = await annotateInteractive(page);
      brief = await pageBrief(page);

      if (looksLikeLogin(page.url(), brief)) {
        const ok = await waitForLogin(page, onChunk, signal);
        if (!ok) return { exitCode: 1 };
        continue;
      }

      const elementsJson = JSON.stringify(elements, null, 0).slice(0, 10_000);
      onChunk("info", `规划第 ${step} 步（${elements.length} 个可交互元素）…\n`);

      let act: WbAction;
      try {
        act = await planNextAction(cfg, {
          goal,
          brief,
          elementsJson,
          history: history.map((h, i) => `${i + 1}. ${h}`).join("\n"),
          signal,
        });
      } catch (e) {
        onChunk(
          "stderr",
          `规划失败: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        return { exitCode: 1 };
      }

      if (act.thought) {
        onChunk("markdown", `- 思考：${act.thought}\n`);
      }

      if (act.action === "done") {
        onChunk("markdown", `\n**完成**：${act.message}\n`);
        return { exitCode: 0 };
      }
      if (act.action === "fail") {
        onChunk("markdown", `\n**失败**：${act.message}\n`);
        return { exitCode: 1 };
      }
      if (act.action === "need_login") {
        onChunk("markdown", `\n${act.message}\n`);
        const ok = await waitForLogin(page, onChunk, signal);
        if (!ok) return { exitCode: 1 };
        history.push("need_login → waited");
        continue;
      }

      try {
        const desc = await applyAction(page, act);
        history.push(desc);
        onChunk("markdown", `- 执行：\`${desc}\`\n`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        history.push(`ERROR ${act.action}: ${msg}`);
        onChunk("stderr", `动作失败: ${msg}\n`);
        // 继续让下一轮规划纠错
      }
    }

    onChunk(
      "markdown",
      `\n> 达到最大步数 ${MAX_STEPS}。可查看本机 Chrome 当前页面，或拆成更小目标重试。\n最终页面：${page.url()}\n`,
    );
    return { exitCode: 1 };
  } catch (e) {
    onChunk("stderr", `${e instanceof Error ? e.message : String(e)}\n`);
    onChunk(
      "markdown",
      `\n提示：请确认已安装 Chrome，且 \`tools.claude\` 可用（用于页面规划）。目标站：${workbuddyUrl(cfg)}\n`,
    );
    return { exitCode: 1 };
  }
}
