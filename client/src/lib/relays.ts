import { useSyncExternalStore } from "react";

export const LOCAL_RELAY = "ws://127.0.0.1:8787/ws";
const KEY = "grokbot:relays";

export type RemoteRelay = { id: string; url: string };

export type RelayBook = {
  /** 还没在启动页确认过时为 false，界面会要求先选 Relay */
  ready: boolean;
  mode: "local" | "remote";
  localUrl: string;
  remotes: RemoteRelay[];
  activeRemoteId: string;
};

const listeners = new Set<() => void>();

function emptyBook(): RelayBook {
  return {
    ready: false,
    mode: "local",
    localUrl: LOCAL_RELAY,
    remotes: [],
    activeRemoteId: "",
  };
}

function load(): RelayBook {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyBook();
    const parsed = JSON.parse(raw) as Partial<RelayBook>;
    const remotes = Array.isArray(parsed.remotes)
      ? parsed.remotes.filter((r) => r && typeof r.url === "string" && r.url.trim())
      : [];
    return {
      ready: Boolean(parsed.ready),
      mode: parsed.mode === "remote" ? "remote" : "local",
      localUrl: typeof parsed.localUrl === "string" && parsed.localUrl.trim() ? parsed.localUrl.trim() : LOCAL_RELAY,
      remotes: remotes.map((r) => ({ id: String(r.id || r.url), url: r.url.trim() })),
      activeRemoteId: typeof parsed.activeRemoteId === "string" ? parsed.activeRemoteId : "",
    };
  } catch {
    return emptyBook();
  }
}

let book = load();

function emit() {
  listeners.forEach((l) => l());
}

export function getRelayBook(): RelayBook {
  return book;
}

export function subscribeRelay(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRelayBook(): RelayBook {
  return useSyncExternalStore(subscribeRelay, getRelayBook);
}

export function isLoopbackRelay(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return /127\.0\.0\.1|localhost/i.test(url);
  }
}

export function activeRelayUrl(b: RelayBook = book): string {
  if (b.mode === "remote") {
    const hit = b.remotes.find((r) => r.id === b.activeRemoteId) ?? b.remotes[0];
    if (hit) return hit.url;
  }
  return b.localUrl || LOCAL_RELAY;
}

function persist(next: RelayBook) {
  book = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 无 localStorage 时仅留在内存 */
  }
  emit();
}

export function patchRelayBook(patch: Partial<RelayBook>) {
  persist({ ...book, ...patch });
}

let adoptedAgentRelay = false;

/**
 * 启动页还没确认时，用 Agent 当前地址作为初始选择：
 * 远程就记下来并选中，本机就保持本地。确认之后只补充新的远程地址，不改当前模式。
 */
export function adoptAgentRelay(url: string) {
  if (book.ready) {
    rememberRemote(url);
    return;
  }
  if (adoptedAgentRelay) return;
  adoptedAgentRelay = true;
  const trimmed = url.trim();
  if (!/^wss?:\/\//i.test(trimmed)) return;
  if (isLoopbackRelay(trimmed)) {
    persist({ ...book, mode: "local", localUrl: trimmed });
    return;
  }
  rememberRemote(trimmed);
  const hit = book.remotes.find((r) => r.url === trimmed);
  if (hit) persist({ ...book, mode: "remote", activeRemoteId: hit.id });
}

/** 把 Agent 当前的非本地地址记进远程列表，不改变正在使用的模式 */
export function rememberRemote(url: string) {
  const trimmed = url.trim();
  if (!/^wss?:\/\//i.test(trimmed) || isLoopbackRelay(trimmed)) return;
  if (book.remotes.some((r) => r.url === trimmed)) return;
  const id = `r${Date.now().toString(36)}`;
  persist({
    ...book,
    remotes: [...book.remotes, { id, url: trimmed }],
    activeRemoteId: book.activeRemoteId || id,
  });
}

export function addRemote(url: string) {
  const trimmed = url.trim();
  if (!/^wss?:\/\//i.test(trimmed)) throw new Error("地址要以 ws:// 或 wss:// 开头");
  if (isLoopbackRelay(trimmed)) throw new Error("本机地址请用「本地」，远程列表只放局域网或公网 Relay");
  rememberRemote(trimmed);
  const hit = book.remotes.find((r) => r.url === trimmed);
  if (hit) persist({ ...book, mode: "remote", activeRemoteId: hit.id });
}

export function removeRemote(id: string) {
  const remotes = book.remotes.filter((r) => r.id !== id);
  const activeRemoteId = book.activeRemoteId === id ? (remotes[0]?.id ?? "") : book.activeRemoteId;
  persist({
    ...book,
    remotes,
    activeRemoteId,
    mode: remotes.length === 0 ? "local" : book.mode,
  });
}

export function selectLocal(url?: string) {
  persist({
    ...book,
    mode: "local",
    localUrl: url?.trim() || book.localUrl || LOCAL_RELAY,
  });
}

export function selectRemote(id: string) {
  persist({ ...book, mode: "remote", activeRemoteId: id });
}

export function markRelayReady() {
  persist({ ...book, ready: true });
}
