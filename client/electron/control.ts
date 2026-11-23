import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import type { CtlFrame } from "@grokbot/protocol";
import { ctlFile } from "./paths.js";

export type CtlState = "unavailable" | "connecting" | "attached";

const RETRY_MS = 1500;
const REQ_TIMEOUT_MS = 30_000;

function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Agent 本地控制通道客户端：发现 agent/data/ctl.json → ws attach（token 鉴权）。
 * 断开/文件变化自动重连，Agent 无论由谁启动都能接上。
 */
export class ControlClient {
  private ws: WebSocket | null = null;
  private token = "";
  private port = 0;
  private pid = 0;
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private _state: CtlState = "unavailable";

  onState: (s: CtlState) => void = () => {};
  onFrame: (f: CtlFrame) => void = () => {};

  get state(): CtlState {
    return this._state;
  }

  start() {
    this.stopped = false;
    this.ensure();
    try {
      // ctl.json 在 Agent 启动时写入/退出时删除 → 目录监听触发即时重连
      fs.watch(path.dirname(ctlFile), () => this.ensure());
    } catch {
      /* 目录暂不存在则退化为定时轮询 */
      setInterval(() => this.ensure(), 3000);
    }
    setInterval(() => {
      // 兜底：pid 死了但 socket 还挂着（理论上不会）→ 主动断开触发重连
      if (this.pid && !pidAlive(this.pid) && this.ws) this.ws.close();
    }, 5000);
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }

  private setState(s: CtlState) {
    if (this._state === s) return;
    this._state = s;
    this.onState(s);
  }

  private readDiscovery(): boolean {
    try {
      const d = JSON.parse(fs.readFileSync(ctlFile, "utf8")) as {
        port?: number;
        token?: string;
        pid?: number;
      };
      if (d?.port && d?.token) {
        this.port = d.port;
        this.token = d.token;
        this.pid = d.pid ?? 0;
        return true;
      }
    } catch {
      /* 文件不存在/残留半截 */
    }
    return false;
  }

  private ensure() {
    if (this.stopped || this.ws) return;
    if (!this.readDiscovery()) {
      this.setState("unavailable");
      return;
    }
    if (this.pid && !pidAlive(this.pid)) {
      this.setState("unavailable");
      return;
    }
    this.connect();
  }

  private connect() {
    this.setState("connecting");
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws = ws;

    ws.on("open", () => {
      ws.send(JSON.stringify({ kind: "auth", token: this.token }));
    });

    ws.on("message", (raw) => {
      let frame: CtlFrame;
      try {
        frame = JSON.parse(raw.toString()) as CtlFrame;
      } catch {
        return;
      }
      if (frame.kind === "res") {
        if (frame.id === "auth") {
          if (frame.ok) this.setState("attached");
          else ws.close(4003, "auth rejected");
          return;
        }
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id);
        clearTimeout(p.timer);
        frame.ok ? p.resolve(frame.data) : p.reject(new Error(frame.error));
        return;
      }
      this.onFrame(frame);
    });

    ws.on("close", () => {
      if (this.ws === ws) this.ws = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("控制通道已断开"));
        this.pending.delete(id);
      }
      // 断线后立刻离开 connecting，否则启动按钮会一直处于 loading 且无法再点
      this.setState("unavailable");
      if (!this.stopped) {
        this.retryTimer = setTimeout(() => this.ensure(), RETRY_MS);
      }
    });
    ws.on("error", () => {
      /* close 会跟着触发，统一在 close 处理 */
    });
  }

  request(type: string, payload?: unknown): Promise<unknown> {
    if (this.state !== "attached" || !this.ws) {
      return Promise.reject(new Error("Agent 未连接（可能未启动）"));
    }
    const id = `c${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求超时: ${type}`));
      }, REQ_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ kind: "req", id, type, payload }));
    });
  }
}
