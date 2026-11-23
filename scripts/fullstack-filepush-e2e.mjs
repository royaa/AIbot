/**
 * 全栈实测：真实 agent/dist + 本地 relay + 模拟手机。
 * 覆盖两条真实路径：
 *   A. 任务完成 → 自动扫描新 apk → file.offer → 手机 HTTP 下载（sha256 校验）
 *   B. 「取文件」工具 → 手动推送 releases/README.md → 下载校验
 *
 * 安全：测试前备份 agent.config.local.json（生产 token），结束后原样恢复；
 *       不碰 agent.config.json；假 apk 放在 .fs-e2e/ 临时目录，测完删除。
 * 用法：node scripts/fullstack-filepush-e2e.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = 8794;
const ROOT = path.resolve(import.meta.dirname, "..");
const LOCAL_CFG = path.join(ROOT, "agent", "agent.config.local.json");
const AGENT_ENV = path.join(ROOT, "agent", ".env");
// 备份必须与原文件同盘（Windows rename 跨盘会 EXDEV）
const BACKUP = `${LOCAL_CFG}.fs-e2e-bak`;
const ENV_BACKUP = `${AGENT_ENV}.fs-e2e-bak`;
const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-fs-files-"));
const fakeDir = path.join(ROOT, ".fs-e2e");
let hadLocalCfg = false;
let hadEnv = false;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

function send(ws, type, payload, role) {
  ws.send(JSON.stringify({ id: crypto.randomUUID(), ts: Date.now(), type, role, payload }));
}

function waitMsg(ws, wantType, timeoutMs = 20000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${wantType} 超时`)), timeoutMs);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === wantType && filter(msg.payload)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

const relay = spawn(process.execPath, [path.join(ROOT, "relay", "dist", "index.js")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", JWT_SECRET: "fs-e2e", FILES_DIR: filesDir },
  stdio: ["ignore", "ignore", "pipe"],
});
relay.stderr.on("data", (b) => process.stderr.write(`[relay] ${b}`));

let agent;
let agentPairCodeResolve;
const agentPairCode = new Promise((r) => (agentPairCodeResolve = r));
let agentOut = "";

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("relay 未启动");
}

async function main() {
  // 备份生产 token：必须 move 走（agent 会读它连生产 Relay）
  hadLocalCfg = fs.existsSync(LOCAL_CFG);
  if (hadLocalCfg) fs.renameSync(LOCAL_CFG, BACKUP);
  // agent/.env 的 RELAY_URL 用 override:true 会盖掉进程环境变量，
  // 测试期间临时改写为本地地址（其余行原样保留），结束后恢复
  hadEnv = fs.existsSync(AGENT_ENV);
  if (hadEnv) {
    fs.copyFileSync(AGENT_ENV, ENV_BACKUP);
    const patched = fs
      .readFileSync(AGENT_ENV, "utf8")
      .replace(/^RELAY_URL=.*$/m, `RELAY_URL=ws://127.0.0.1:${PORT}/ws`);
    fs.writeFileSync(AGENT_ENV, patched, "utf8");
  }

  await waitHealthy();

  // 起真实 Agent（.env 已指向本地；无 token → 打印配对码）
  agent = spawn(process.execPath, [path.join(ROOT, "agent", "dist", "index.js")], {
    env: { ...process.env, RELAY_URL: `ws://127.0.0.1:${PORT}/ws` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  agent.stdout.on("data", (b) => {
    const s = b.toString();
    agentOut += s;
    const m = s.match(/配对码[:：]\s*([A-F0-9]{8})/);
    if (m) agentPairCodeResolve(m[1]);
  });
  agent.stderr.on("data", (b) => process.stderr.write(`[agent] ${b}`));

  const code = await Promise.race([
    agentPairCode,
    new Promise((_, rej) => setTimeout(() => rej(new Error("未等到配对码")), 20000)),
  ]);
  check("真实 Agent 启动并打印配对码", true, `code=${code}`);

  // 模拟手机：配对
  const phone = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((r) => phone.on("open", r));
  send(phone, "pair.complete", { pairCode: code, deviceName: "fullstack-e2e" }, "mobile");
  const auth = await waitMsg(phone, "auth.token");
  check("手机配对成功", !!auth.payload.accessToken);
  const status = await waitMsg(phone, "agent.status");
  const grokbotWs = status.payload.workspaces.find((w) => w.id === "grokbot");
  check("收到 agent.status 工作区列表", !!grokbotWs);

  // ---------- A. 任务完成 → 自动推送新 apk ----------
  fs.mkdirSync(fakeDir, { recursive: true });
  const fakeApk = path.join(fakeDir, "fullstack-fake-app.apk");
  const fakeBuf = crypto.randomBytes(256 * 1024);
  fs.writeFileSync(fakeApk, fakeBuf);

  const taskA = crypto.randomUUID();
  send(phone, "task.create", {
    taskId: taskA,
    workspaceId: "grokbot",
    tool: "svn",
    prompt: "status .",
    options: { svnAction: "status", svnWorkDir: "." },
  }, "mobile");

  const offerA = await waitMsg(phone, "file.offer", 60000, (p) => p.taskId === taskA);
  check(
    "A 自动推送：任务完成扫到新 apk",
    offerA.payload.name === "fullstack-fake-app.apk" && offerA.payload.size === fakeBuf.length,
  );
  const dlA = await fetch(`http://127.0.0.1:${PORT}${offerA.payload.url}`);
  const dlABuf = Buffer.from(await dlA.arrayBuffer());
  check(
    "A 手机下载 sha256 一致",
    dlA.status === 200 &&
      crypto.createHash("sha256").update(dlABuf).digest("hex") === offerA.payload.sha256 &&
      dlABuf.equals(fakeBuf),
  );

  // ---------- B. 「取文件」工具手动推送 ----------
  const taskB = crypto.randomUUID();
  send(phone, "task.create", {
    taskId: taskB,
    workspaceId: "grokbot",
    tool: "file",
    prompt: "releases/README.md",
  }, "mobile");
  const offerB = await waitMsg(phone, "file.offer", 30000, (p) => p.taskId === taskB && p.name === "README.md");
  check("B 取文件：收到 README.md offer", offerB.payload.size > 0);
  const localSha = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, "releases", "README.md")))
    .digest("hex");
  check("B offer 与本地文件 sha256 一致", offerB.payload.sha256 === localSha);
  const doneB = await waitMsg(phone, "task.status", 30000, (p) => p.taskId === taskB && p.status === "completed");
  check("B 取文件任务 completed", !!doneB);

  phone.close();
}

try {
  await main();
} catch (e) {
  failed++;
  console.error("❌ 全栈测试异常:", e);
  if (agentOut) console.error(`[agent 最后输出]\n${agentOut.slice(-800)}`);
} finally {
  // 清理：先杀 agent（避免其再写 token），再恢复生产配置
  try { agent?.kill(); } catch {}
  await new Promise((r) => setTimeout(r, 500));
  try { relay?.kill(); } catch {}
  try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(filesDir, { recursive: true, force: true }); } catch {}
  if (fs.existsSync(BACKUP)) {
    fs.copyFileSync(BACKUP, LOCAL_CFG);
    fs.rmSync(BACKUP);
    console.log("已恢复 agent.config.local.json（生产 token）");
  } else if (!hadLocalCfg && fs.existsSync(LOCAL_CFG)) {
    // 仅当测试前本就没有该文件时，才清理测试生成的临时 token
    fs.rmSync(LOCAL_CFG);
    console.log("已清理测试生成的临时 token");
  }
  if (fs.existsSync(ENV_BACKUP)) {
    fs.copyFileSync(ENV_BACKUP, AGENT_ENV);
    fs.rmSync(ENV_BACKUP);
    console.log("已恢复 agent/.env");
  }
}

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
