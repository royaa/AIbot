/**
 * 文件通道 e2e 自测（不起手机）：
 *   relay(dist) + 模拟 agent + 模拟 mobile
 * 验证：配对 → agent HTTP 上传 → ws file.offer 广播 → 手机 HTTP 下载（sha256 校验、Range 断点）
 * 用法：node scripts/file-transfer-e2e.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = 8791;
const ROOT = path.resolve(import.meta.dirname, "..");
const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "grokbot-files-"));

const relay = spawn(process.execPath, [path.join(ROOT, "relay", "dist", "index.js")], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    JWT_SECRET: "e2e-test-secret",
    FILES_DIR: filesDir,
    FILES_TTL_HOURS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
relay.stdout.on("data", () => {});
relay.stderr.on("data", (b) => process.stderr.write(`[relay] ${b}`));

const http = `http://127.0.0.1:${PORT}`;
const wsUrl = `ws://127.0.0.1:${PORT}/ws`;

function wsCollect(ws, { wantType, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${wantType} 超时`)), timeoutMs);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "error") {
        console.error("  [ws error]", JSON.stringify(msg.payload));
      }
      if (msg.type === wantType) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    ws.on("error", reject);
  });
}

function send(ws, type, payload, role) {
  ws.send(JSON.stringify({
    id: crypto.randomUUID(),
    ts: Date.now(),
    type,
    role,
    payload,
  }));
}

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${http}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("relay 未启动");
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

try {
  await waitHealthy();
  check("relay /health", true);

  // ---- agent：pair.start 换 token ----
  const agentId = crypto.randomUUID();
  const agentWs = new WebSocket(wsUrl);
  await new Promise((r) => agentWs.on("open", r));
  const code = ("E2E" + crypto.randomBytes(3).toString("hex").toUpperCase()).slice(0, 8);
  send(agentWs, "pair.start", {
    pairCode: code,
    agentId,
    hostname: "e2e-pc",
    expiresAt: Date.now() + 600000,
  }, "agent");
  const agentAuth = await wsCollect(agentWs, { wantType: "auth.token" });
  const agentToken = agentAuth.payload.accessToken;
  check("agent pair.start → auth.token", !!agentToken);

  // ---- agent：上传 2MB 文件 ----
  const size = 2 * 1024 * 1024 + 123;
  const buf = crypto.randomBytes(size);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const upRes = await fetch(`${http}/files/upload?name=e2e-app.apk&size=${size}&mimeType=application%2fvnd.android.package-archive&sha256=${sha256}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${agentToken}`,
      "content-type": "application/octet-stream",
    },
    body: buf,
  });
  const up = await upRes.json();
  check("HTTP 上传 2MB", upRes.ok && !!up.url, `fileId=${up.fileId}`);

  // ---- agent：ws 发 file.offer ----
  const offerMsg = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    type: "file.offer",
    role: "agent",
    payload: {
      fileId: up.fileId,
      name: "e2e-app.apk",
      size,
      mimeType: "application/vnd.android.package-archive",
      sha256,
      url: up.url,
      expiresAt: up.expiresAt,
    },
  };
  agentWs.send(JSON.stringify(offerMsg));

  // ---- mobile：配对并收 offer ----
  const mobileWs = new WebSocket(wsUrl);
  await new Promise((r) => mobileWs.on("open", r));
  // 手机在 offer 之后才连：靠 relay 的 recentFileOffers replay 收到
  send(mobileWs, "pair.complete", { pairCode: code, deviceName: "e2e-phone" }, "mobile");
  const mobileAuth = await wsCollect(mobileWs, { wantType: "auth.token" });
  check("mobile pair.complete → auth.token", !!mobileAuth.payload.accessToken);
  const offer = await wsCollect(mobileWs, { wantType: "file.offer" });
  check("离线手机连上后补发 file.offer", offer.payload.url === up.url);

  // ---- mobile：HTTP 下载 + sha256 校验 ----
  const dl = await fetch(`${http}${up.url}`);
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  const dlSha = crypto.createHash("sha256").update(dlBuf).digest("hex");
  check("HTTP 下载全文", dl.status === 200 && dlBuf.length === size && dlSha === sha256,
    `${dlBuf.length}B`);

  // ---- Range 断点续传 ----
  const range = await fetch(`${http}${up.url}`, { headers: { range: "bytes=100-199" } });
  const rangeBuf = Buffer.from(await range.arrayBuffer());
  check("Range bytes=100-199", range.status === 206 && rangeBuf.length === 100
    && rangeBuf.equals(buf.subarray(100, 200)),
    `status=${range.status} len=${rangeBuf.length}`);
  const suffix = await fetch(`${http}${up.url}`, { headers: { range: "bytes=-50" } });
  const suffixBuf = Buffer.from(await suffix.arrayBuffer());
  check("Range bytes=-50（后缀）", suffix.status === 206 && suffixBuf.length === 50
    && suffixBuf.equals(buf.subarray(size - 50)));

  // ---- 鉴权负例 ----
  const noToken = await fetch(`${http}/files/${up.fileId}`);
  check("无 token 404", noToken.status === 404);
  const badToken = await fetch(`${http}/files/${up.fileId}?t=deadbeef`);
  check("错 token 404", badToken.status === 404);
  const noAuth = await fetch(`${http}/files/upload?name=x&size=1`, { method: "POST", body: "x" });
  check("上传未带 token 401", noAuth.status === 401);

  // ---- 手机重连后仍能拿到 offer replay（recentFileOffers）----
  const mobileWs2 = new WebSocket(wsUrl);
  await new Promise((r) => mobileWs2.on("open", r));
  send(mobileWs2, "hello", { role: "mobile", token: mobileAuth.payload.accessToken }, "mobile");
  const offer2 = await wsCollect(mobileWs2, { wantType: "file.offer" });
  check("手机重连 replay file.offer", offer2.payload.fileId === up.fileId);

  agentWs.close();
  mobileWs.close();
  mobileWs2.close();
} catch (e) {
  failed++;
  console.error("❌ e2e 异常:", e);
} finally {
  relay.kill();
  fs.rmSync(filesDir, { recursive: true, force: true });
}

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
