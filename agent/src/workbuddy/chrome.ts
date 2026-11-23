import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { AgentConfig } from "../config.js";

const agentRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const DEFAULT_URL = "https://workbuddy.cn/app";
const DEFAULT_PORT = 9333;

let chromeProc: ChildProcess | undefined;
let browser: Browser | undefined;

function resolveChromePath(cfg: AgentConfig): string {
  const configured = cfg.tools.chrome?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  const candidates = [
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error("未找到 Chrome/Edge，请在 agent.config.json 的 tools.chrome 配置绝对路径");
}

export function workbuddyUrl(cfg: AgentConfig): string {
  return (cfg.tools.workbuddyUrl?.trim() || DEFAULT_URL).replace(/\/$/, "");
}

export function workbuddyCdpPort(cfg: AgentConfig): number {
  const n = Number(cfg.tools.workbuddyCdpPort ?? DEFAULT_PORT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

export function workbuddyProfileDir(cfg: AgentConfig): string {
  const configured = cfg.tools.workbuddyProfile?.trim();
  if (configured) return path.resolve(configured);
  return path.join(agentRoot, "data", "workbuddy-chrome-profile");
}

function cdpEndpoint(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** 启动或附着带专用配置的 Chrome，返回 Playwright Page（WorkBuddy 标签） */
export async function ensureWorkbuddyPage(
  cfg: AgentConfig,
  onInfo?: (msg: string) => void,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const port = workbuddyCdpPort(cfg);
  const url = workbuddyUrl(cfg);
  const profile = workbuddyProfileDir(cfg);
  fs.mkdirSync(profile, { recursive: true });

  if (!(await portOpen(port))) {
    const chrome = resolveChromePath(cfg);
    onInfo?.(`启动 Chrome（CDP :${port}，专用配置目录）…`);
    chromeProc = spawn(
      chrome,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        url,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      },
    );
    chromeProc.unref();
    const ok = await waitForPort(port, 25_000);
    if (!ok) {
      throw new Error(`Chrome 远程调试端口 ${port} 未就绪，请检查 tools.chrome 路径或端口占用`);
    }
  } else {
    onInfo?.(`已附着现有 Chrome（CDP :${port}）`);
  }

  if (!browser || !browser.isConnected()) {
    browser = await chromium.connectOverCDP(cdpEndpoint(port));
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  let page =
    context.pages().find((p) => {
      try {
        return p.url().includes("workbuddy.cn");
      } catch {
        return false;
      }
    }) ?? context.pages()[0];

  if (!page) {
    page = await context.newPage();
  }

  const current = page.url();
  if (!current.includes("workbuddy.cn")) {
    onInfo?.(`打开 ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else {
    // 已在站点内，尽量回到 app 入口
    if (!/workbuddy\.cn\/app/i.test(current)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
  }

  await page.bringToFront().catch(() => undefined);
  return { browser, context, page };
}

export async function closeWorkbuddyBrowser() {
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
  browser = undefined;
}
