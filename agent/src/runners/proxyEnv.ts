import { execFileSync } from "node:child_process";
import net from "node:net";

let cached: Promise<NodeJS.ProcessEnv> | undefined;

/**
 * Cursor Agent 的对话走 agentn.global.api5.cursor.sh。
 * 这条线路在国内经常被重置，CLI 只显示 Error unavailable。
 * 系统代理没打开时，只要本机回环代理端口还在听，就只给这个子进程补上。
 */
export function cursorAgentProxyEnv(): Promise<NodeJS.ProcessEnv> {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) return Promise.resolve({});
  cached ??= resolveLoopbackProxy();
  return cached;
}

async function resolveLoopbackProxy(): Promise<NodeJS.ProcessEnv> {
  const raw = readWindowsProxyServer();
  const url = raw ? toLoopbackProxyUrl(raw) : undefined;
  if (!url) return {};
  const ok = await portOpen(url.hostname, Number(url.port));
  if (!ok) return {};
  const value = url.toString().replace(/\/$/, "");
  return {
    HTTP_PROXY: value,
    HTTPS_PROXY: value,
    http_proxy: value,
    https_proxy: value,
    NO_PROXY: "localhost,127.0.0.1,::1",
  };
}

function readWindowsProxyServer(): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const out = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        "/v",
        "ProxyServer",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 3000 },
    );
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(out);
    return m?.[1];
  } catch {
    return undefined;
  }
}

function toLoopbackProxyUrl(raw: string): URL | undefined {
  const perScheme = /(?:^|;)\s*https?=([^;]+)/i.exec(raw);
  const hostport = (perScheme?.[1] ?? raw).trim();
  const withScheme = /^https?:\/\//i.test(hostport) ? hostport : `http://${hostport}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return undefined;
  if (!url.port) return undefined;
  return url;
}

function portOpen(host: string, port: number): Promise<boolean> {
  if (!Number.isFinite(port) || port <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
