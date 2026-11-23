/**
 * Agent 文件推送链路 e2e（使用 agent/dist 真实产物，不碰 agent.config.local.json）：
 *   本地 relay → 模拟 agent 配对拿 token → scanNewArtifacts 扫描 → pushFileToPhone 真上传
 *   → 模拟手机收 file.offer → HTTP 下载校验
 * 用法：node scripts/agent-filepush-e2e.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import {
  httpBaseFromWsUrl,
  pushFileToPhone,
  scanNewArtifacts,
  setOfferSender,
} from "../agent/dist/filePush.js";

const PORT = 8793;
const ROOT = path.resolve(import.meta.dirname, "..");
const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-agent-e2e-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "gb-ws-"));

const relay = spawn(process.execPath, [path.join(ROOT, "relay", "dist", "index.js")], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    JWT_SECRET: "agent-e2e-secret",
    FILES_DIR: filesDir,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
relay.stderr.on("data", (b) => process.stderr.write(`[relay] ${b}`));

const http = `http://127.0.0.1:${PORT}`;
const wsUrl = `ws://127.0.0.1:${PORT}/ws`;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

function send(ws, type, payload, role) {
  ws.send(JSON.stringify({ id: crypto.randomUUID(), ts: Date.now(), type, role, payload }));
}

function waitMsg(ws, wantType, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${wantType} 超时`)), timeoutMs);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === wantType) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${http}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("relay 未启动");
}

try {
  await waitHealthy();

  // 工作区造产物：releases/app-release.apk（新）+ node_modules/junk.apk（应被排除）+ 旧 apk（应被 mtime 过滤）
  const newApk = path.join(workspace, "releases", "app-release.apk");
  fs.mkdirSync(path.dirname(newApk), { recursive: true });
  const apkBuf = crypto.randomBytes(512 * 1024);
  fs.writeFileSync(newApk, apkBuf);
  fs.mkdirSync(path.join(workspace, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "node_modules", "x", "junk.apk"), Buffer.alloc(10));
  const oldApk = path.join(workspace, "releases", "old.apk");
  fs.writeFileSync(oldApk, Buffer.alloc(20));
  const oldTime = new Date(Date.now() - 3600_000);
  fs.utimesSync(oldApk, oldTime, oldTime);

  const cfg = {
    agentId: crypto.randomUUID(),
    relayUrl: wsUrl,
    token: "",
    workspaces: [],
    tools: {},
    fileOffer: {},
  };

  // ---- scanNewArtifacts（真实配置默认值：** 任意层级 .apk、排除 node_modules） ----
  const since = Date.now() - 60_000;
  const scanned = scanNewArtifacts(cfg, workspace, since);
  check(
    "scanNewArtifacts 只捞新 apk、排除 node_modules",
    scanned.length === 1 && scanned[0] === newApk,
    scanned.map((p) => path.relative(workspace, p)).join(","),
  );

  // ---- 模拟 agent 配对（供上传 Bearer token 用） ----
  const agentWs = new WebSocket(wsUrl);
  await new Promise((r) => agentWs.on("open", r));
  const code = "AGT" + crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
  send(agentWs, "pair.start", {
    pairCode: code.slice(0, 8),
    agentId: cfg.agentId,
    hostname: "e2e-agent",
    expiresAt: Date.now() + 600000,
  }, "agent");
  const auth = await waitMsg(agentWs, "auth.token");
  cfg.token = auth.payload.accessToken;

  const offers = [];
  setOfferSender((msg) => {
    offers.push(msg);
    agentWs.send(JSON.stringify(msg));
  });
  const infos = [];
  const onChunk = (kind, text) => infos.push(text);

  // ---- pushFileToPhone（真实上传 + file.offer） ----
  const task = { taskId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const offer = await pushFileToPhone(cfg, task, newApk, onChunk);
  check("pushFileToPhone 上传并生成 offer", !!offer.url && offer.size === 512 * 1024);
  check("info 提示包含文件名", infos.join("").includes("app-release.apk"));

  // ---- 模拟手机收 offer 并下载 ----
  const mobileWs = new WebSocket(wsUrl);
  await new Promise((r) => mobileWs.on("open", r));
  send(mobileWs, "pair.complete", { pairCode: code.slice(0, 8), deviceName: "phone" }, "mobile");
  await waitMsg(mobileWs, "auth.token");
  const got = await waitMsg(mobileWs, "file.offer");
  check("手机收到 file.offer", got.payload.fileId === offer.fileId);

  const dl = await fetch(`${http}${got.payload.url}`);
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  check(
    "手机下载 sha256 一致",
    dl.status === 200 &&
      dlBuf.equals(apkBuf) &&
      crypto.createHash("sha256").update(dlBuf).digest("hex") === got.payload.sha256,
  );

  // ---- httpBaseFromWsUrl ----
  check(
    "httpBaseFromWsUrl",
    httpBaseFromWsUrl(wsUrl) === http && httpBaseFromWsUrl("wss://a.b/ws") === "https://a.b",
  );

  agentWs.close();
  mobileWs.close();
} catch (e) {
  failed++;
  console.error("❌ e2e 异常:", e);
} finally {
  relay.kill();
  fs.rmSync(filesDir, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
