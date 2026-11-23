/**
 * 简易手机端模拟：配对 + 发送 grok 任务
 * 用法: node scripts/mobile-test-client.mjs [配对码]
 */
import WebSocket from "ws";
import crypto from "node:crypto";
import readline from "node:readline";

const RELAY = process.env.RELAY_URL ?? "ws://127.0.0.1:8787/ws";
const pairCode = process.argv[2]?.toUpperCase();

const ws = new WebSocket(RELAY);
let token = "";
let agentId = "";

function send(type, role, payload) {
  ws.send(JSON.stringify({ id: crypto.randomUUID(), ts: Date.now(), type, role, payload }));
}

ws.on("open", () => {
  send("hello", "mobile", { role: "mobile", version: "test" });
  if (pairCode) {
    send("pair.complete", "mobile", { pairCode, deviceName: "test-phone" });
  }
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log("[recv]", msg.type, JSON.stringify(msg.payload).slice(0, 200));

  if (msg.type === "auth.token") {
    token = msg.payload.accessToken;
    agentId = msg.payload.agentId;
    send("hello", "mobile", { role: "mobile", token, deviceId: msg.payload.deviceId });
    const taskId = crypto.randomUUID();
    send("task.create", "mobile", {
      taskId,
      workspaceId: "grokbot",
      tool: "grok",
      prompt: "用一句话介绍这个项目目录是做什么的",
    });
  }

  if (msg.type === "task.output") process.stdout.write(msg.payload.text);
  if (msg.type === "task.status" && msg.payload.status !== "running") {
    console.log("\n[task]", msg.payload.status);
    ws.close();
  }
});

ws.on("error", (e) => console.error(e));
