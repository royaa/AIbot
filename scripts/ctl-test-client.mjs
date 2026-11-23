#!/usr/bin/env node
/**
 * Control 通道冒烟测试客户端：attach 到运行中的 Agent，
 * 依次执行 auth → status.get → config.get → logs.tail → cli.config.get → cli.probe。
 * 用法：node scripts/ctl-test-client.mjs [只跑指定请求，逗号分隔]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ctlFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "agent",
  "data",
  "ctl.json",
);
if (!fs.existsSync(ctlFile)) {
  console.error("未发现 agent/data/ctl.json，Agent 未运行或控制通道未开启");
  process.exit(1);
}
const { port, token } = JSON.parse(fs.readFileSync(ctlFile, "utf8"));
const ws = new WebSocket(`ws://127.0.0.1:${port}`);

const only = process.argv[2] ? process.argv[2].split(",") : null;
let nextId = 1;
const pending = new Map();
let logCount = 0;

function req(type, payload) {
  const id = `t${nextId++}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ kind: "req", id, type, payload }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`请求超时: ${type}`));
      }
    }, 30_000);
  });
}

const show = (name, data) =>
  console.log(`\n=== ${name} ===\n${JSON.stringify(data, null, 2).slice(0, 2000)}`);

ws.on("open", () => {
  ws.send(JSON.stringify({ kind: "auth", token }));
});
ws.on("message", async (raw) => {
  const frame = JSON.parse(raw.toString());
  if (frame.kind === "res") {
    const p = pending.get(frame.id);
    if (!p) return;
    pending.delete(frame.id);
    if (frame.ok) p.resolve(frame.data);
    else p.reject(new Error(frame.error));
    return;
  }
  if (frame.kind === "event") {
    if (frame.event === "log") {
      logCount++;
      if (logCount <= 3) console.log(`[event:log] ${frame.data.text}`);
    } else if (frame.event === "state") {
      console.log(
        `[event:state] ${frame.data.connectionState} pairing=${frame.data.currentPairing?.pairCode ?? "-"}`,
      );
    } else {
      console.log(`[event:${frame.event}]`);
    }
    return;
  }
});
ws.on("close", (code, reason) => {
  console.error(`连接关闭: ${code} ${reason}`);
  process.exit(1);
});
ws.on("error", (e) => {
  console.error(`连接错误: ${e.message}`);
  process.exit(1);
});

// 等认证响应后顺序执行请求
await new Promise((r) => setTimeout(r, 500));

try {
  const steps = {
    "status.get": async () => show("status.get", await req("status.get")),
    "config.get": async () => show("config.get", await req("config.get")),
    "logs.tail": async () =>
      show("logs.tail", await req("logs.tail", { limit: 5 })),
    "cli.config.get": async () =>
      show("cli.config.get(grok)", await req("cli.config.get", { cli: "grok" })),
    "cli.probe": async () =>
      show("cli.probe(claude,svn)", await req("cli.probe", { ids: ["claude", "svn"] })),
  };
  const names = only ? Object.keys(steps).filter((k) => only.includes(k)) : Object.keys(steps);
  for (const name of names) await steps[name]();
  console.log("\n✅ 全部请求成功");
  process.exit(0);
} catch (e) {
  console.error(`\n❌ 失败: ${e.message}`);
  process.exit(1);
}
