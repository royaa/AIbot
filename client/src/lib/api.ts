import { useSyncExternalStore } from "react";
import type { AgentStatus, CtlFrame, LogEntry } from "@grokbot/protocol";

type Api = {
  onState: (cb: (s: string) => void) => void;
  getCtlState: () => Promise<string>;
  onFrame: (cb: (f: CtlFrame) => void) => () => void;
  request: (type: string, payload?: unknown) => Promise<unknown>;
  startAgent: () => Promise<{ ok: boolean }>;
  stopAgent: () => Promise<{ ok: boolean }>;
  restartAgent: () => Promise<{ ok: boolean }>;
};

declare global {
  interface Window {
    grokbot: Api;
  }
}

export const api = window.grokbot;
export const request = <T,>(type: string, payload?: unknown): Promise<T> => {
  if (!api) return Promise.reject(new Error("控制通道不可用"));
  return Promise.resolve().then(() => api.request(type, payload) as Promise<T>);
};

// ─── 轻量全局 store（useSyncExternalStore 订阅） ────────────

export type StoreState = {
  ctl: string; // unavailable | connecting | attached
  status: AgentStatus | null;
  logs: LogEntry[];
  installBusy: string | null;
  installLines: string[];
};

let state: StoreState = {
  // 未知时按未运行处理：默认 connecting 会把「启动 Agent」锁成 loading，
  // 而主进程状态广播又经常发生在订阅之前，界面就会一直停在启动页
  ctl: "unavailable",
  status: null,
  logs: [],
  installBusy: null,
  installLines: [],
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<StoreState>) => {
  state = { ...state, ...patch };
  emit();
};

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getState = () => state;
export const useStore = (): StoreState => useSyncExternalStore(subscribe, getState);

const MAX_LOGS = 600;

let storeReady = false;

export function initStore(): void {
  if (storeReady || typeof window === "undefined" || !window.grokbot) return;
  storeReady = true;
  api.onState((s) => {
    set({ ctl: s });
    if (s === "attached") void refreshStatus();
  });
  void api.getCtlState().then((s) => {
    set({ ctl: s });
    if (s === "attached") void refreshStatus();
  }).catch(() => {
    set({ ctl: "unavailable" });
  });
  api.onFrame((f) => {
    if (f.kind !== "event") return;
    if (f.event === "log") {
      const entry = f.data as LogEntry;
      const logs = [...state.logs, entry];
      if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
      set({ logs });
    } else if (f.event === "state") {
      set({ status: f.data as AgentStatus });
    } else if (f.event === "install.output") {
      const ev = f.data as { line: string; stream: string };
      set({ installLines: [...state.installLines.slice(-400), ev.line] });
    } else if (f.event === "install.done") {
      const ev = f.data as { target: string; exitCode: number; ok: boolean };
      set({
        installBusy: null,
        installLines: [
          ...state.installLines,
          `—— ${ev.target} ${ev.ok ? "安装成功" : `失败 exitCode=${ev.exitCode}`} ——`,
        ],
      });
    }
  });
  void refreshStatus();
  // 周期刷新：补齐只在事件间隙变化的字段（uptime、runningTasks 等）
  setInterval(() => {
    if (state.ctl === "attached") void refreshStatus();
  }, 15_000);
  // 历史日志打底
  void request<{ entries: LogEntry[] }>("logs.tail", { limit: 300 })
    .then((r) => {
      if (r.entries.length) set({ logs: r.entries });
    })
    .catch(() => {});
}

export async function refreshStatus(): Promise<void> {
  try {
    set({ status: await request<AgentStatus>("status.get") });
  } catch {
    set({ status: null });
  }
}

export function beginInstall(target: string): void {
  set({ installBusy: target, installLines: [`—— 开始安装 ${target} ——`] });
}

export function clearInstall(): void {
  set({ installBusy: null, installLines: [] });
}

export function fmtUptime(ms: number): string {
  if (!ms) return "-";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}小时${m}分` : m > 0 ? `${m}分${ss}秒` : `${ss}秒`;
}

export function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object" && "message" in e) {
    const message = (e as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "启动失败";
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 模块求值早于 React effect，也早于 did-finish-load，避免漏掉第一次状态
initStore();
