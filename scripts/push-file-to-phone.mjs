#!/usr/bin/env node
/**
 * 手动从 PC 推送任意文件到手机（走真实生产链路）：
 *   1. 读 agent.config.local.json 的 agent token（不打印）
 *   2. WS hello(agent) 连上 Relay
 *   3. HTTP POST /files/upload 上传文件
 *   4. WS 发 file.offer → Relay 广播给在线手机 / 存入 recentFileOffers 供离线手机补发
 *   5. 自校验：HTTP 下载回读 + sha256 比对（下载 token 可重复使用，不影响手机端）
 *
 * ⚠️ Relay 的 agents 注册是单槽：脚本连接期间会临时顶替正在运行的 Agent，
 *    脚本退出后槽位清空（手机短暂看到离线）。跑完请尽快重启 Agent 恢复在线。
 *
 * 用法：node scripts/push-file-to-phone.mjs <文件路径> [--name 显示名]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const ROOT = path.resolve(import.meta.dirname, "..");

// ---------- 参数 ----------
const fileArg = process.argv[2];
if (!fileArg || !fs.existsSync(fileArg)) {
  console.error("用法: node scripts/push-file-to-phone.mjs <文件路径> [--name 显示名]");
  process.exit(1);
}
const absFile = path.resolve(fileArg);
const stat = fs.statSync(absFile);
if (!stat.isFile()) {
  console.error(`不是文件: ${absFile}`);
  process.exit(1);
}
const nameIdx = process.argv.indexOf("--name");
const displayName = nameIdx > -1 && process.argv[nameIdx + 1] ? process.argv[nameIdx + 1] : path.basename(absFile);

// ---------- 配置 ----------
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "agent", "agent.config.json"), "utf8"));
const localPath = path.join(ROOT, "agent", "agent.config.local.json");
if (fs.existsSync(localPath)) Object.assign(cfg, JSON.parse(fs.readFileSync(localPath, "utf8")));
if (!cfg.token) {
  console.error("缺少 agent token（agent.config.local.json）——请先完成配对");
  process.exit(1);
}
let relayUrl = process.env.RELAY_URL?.trim();
const envPath = path.join(ROOT, "agent", ".env");
if (!relayUrl && fs.existsSync(envPath)) {
  const m = fs.readFileSync(envPath, "utf8").match(/^RELAY_URL=(.+)$/m);
  if (m) relayUrl = m[1].trim();
}
relayUrl ||= cfg.relayUrl;

const httpBase = (() => {
  let u = relayUrl.trim();
  if (u.startsWith("wss://")) u = `https://${u.slice(6)}`;
  else if (u.startsWith("ws://")) u = `http://${u.slice(5)}`;
  const parsed = new URL(u);
  return `${parsed.protocol}//${parsed.host}`;
})();

const agentId = JSON.parse(
  Buffer.from(cfg.token.split(".")[1], "base64url").toString("utf8"),
).agentId;

// ---------- 文件信息 ----------
function guessMime(name) {
  const ext = path.extname(name).toLowerCase();
  return {
    ".apk": "application/vnd.android.package-archive",
    ".zip": "application/zip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".txt": "text/plain",
    ".log": "text/plain",
  }[ext] ?? "application/octet-stream";
}
const buf = fs.readFileSync(absFile);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
const mimeType = guessMime(displayName);

console.log(`Relay    : ${relayUrl}  (agentId ${agentId.slice(0, 8)}…)`);
console.log(`文件     : ${absFile}`);
console.log(`大小     : ${buf.length} B   sha256=${sha256.slice(0, 16)}…`);

// ---------- WS 连接 ----------
const ws = new WebSocket(relayUrl);
const watchdog = setTimeout(() => {
  console.error("超时退出");
  process.exit(2);
}, 30_000);

function die(msg) {
  console.error(`❌ ${msg}`);
  try { ws.close(); } catch {}
  process.exit(1);
}

ws.on("error", (e) => die(`WS 连接失败: ${e.message}`));

ws.on("message", async (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.type === "error") die(`Relay 错误: ${JSON.stringify(msg.payload)}`);
  if (msg.type !== "hello") return;

  // hello 成功（agent 身份已注册）→ 上传
  const qs = new URLSearchParams({
    name: displayName,
    size: String(buf.length),
    mimeType,
    sha256,
  });
  const upRes = await fetch(`${httpBase}/files/upload?${qs}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/octet-stream",
    },
    body: buf,
  });
  if (!upRes.ok) die(`上传失败 HTTP ${upRes.status}: ${(await upRes.text()).slice(0, 200)}`);
  const up = await upRes.json();
  console.log(`上传 ✅  fileId=${up.fileId}`);

  // 发 file.offer（taskId 用随机 UUID；App 找不到对应任务会挂到当前会话）
  const offer = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    type: "file.offer",
    role: "agent",
    payload: {
      fileId: up.fileId,
      taskId: crypto.randomUUID(),
      name: displayName,
      size: buf.length,
      mimeType,
      sha256: up.sha256,
      url: up.url,
      expiresAt: up.expiresAt,
    },
  };
  ws.send(JSON.stringify(offer), (err) => {
    if (err) die(`发送 file.offer 失败: ${err.message}`);
    console.log("file.offer 已发出 ✅（在线手机立即收到；离线手机下次连上时补发）");

    // 自校验：下载回读比对（token 可复用，不抢占手机下载）
    fetch(`${httpBase}${up.url}`)
      .then(async (dl) => {
        const back = Buffer.from(await dl.arrayBuffer());
        const ok = dl.status === 200 && crypto.createHash("sha256").update(back).digest("hex") === sha256;
        console.log(ok ? "回读校验 ✅  sha256 一致" : `回读校验 ❌  status=${dl.status} len=${back.length}`);
        clearTimeout(watchdog);
        ws.close();
        process.exit(ok ? 0 : 1);
      })
      .catch((e) => die(`回读失败: ${e.message}`));
  });
});

ws.on("open", () => {
  ws.send(JSON.stringify({
    id: crypto.randomUUID(),
    ts: Date.now(),
    type: "hello",
    role: "agent",
    payload: { role: "agent", agentId, token: cfg.token, version: "0.1.0" },
  }));
});
