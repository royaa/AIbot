import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FileOfferPayload, TaskCreatePayload, WireMessage } from "@grokbot/protocol";
import { createMessage } from "@grokbot/protocol";
import type { AgentConfig } from "./config.js";
import { getFileOfferConfig } from "./config.js";
import type { ChunkHandler } from "./runners/spawnUtil.js";

/**
 * PC → 手机 文件推送：
 *   1. Agent 经 HTTP POST /files/upload 把文件传到 Relay（Bearer agent token）
 *   2. 经 ws 发 file.offer（几百字节）通知手机
 *   3. 手机走 HTTP GET 下载（支持断点续传）
 */

/** ws(s)://host[:port]/path → http(s)://host[:port] */
export function httpBaseFromWsUrl(relayUrl: string): string {
  let u = relayUrl.trim();
  if (u.startsWith("wss://")) u = `https://${u.slice(6)}`;
  else if (u.startsWith("ws://")) u = `http://${u.slice(5)}`;
  else if (!u.startsWith("http")) u = `http://${u}`;
  // 去掉路径部分（/ws 等），保留协议+主机+端口
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return u.replace(/\/+$/, "");
  }
}

export function sha256File(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absPath);
    stream.on("data", (b) => hash.update(b as Buffer));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case ".apk":
      return "application/vnd.android.package-archive";
    case ".zip":
      return "application/zip";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".json":
      return "application/json";
    case ".txt":
    case ".log":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

type UploadResult = { fileId: string; url: string; expiresAt: number };

/** 把本地文件上传到 Relay 文件通道；失败抛错 */
export async function uploadToRelay(
  cfg: AgentConfig,
  absPath: string,
): Promise<UploadResult & { size: number; sha256: string; name: string }> {
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error(`不是文件: ${absPath}`);
  const conf = getFileOfferConfig(cfg);
  if (stat.size > conf.maxFileMb * 1024 * 1024) {
    throw new Error(`文件超过上限 ${conf.maxFileMb}MB: ${fmtSize(stat.size)}`);
  }
  const name = path.basename(absPath);
  const sha256 = await sha256File(absPath);
  const base = httpBaseFromWsUrl(cfg.relayUrl);
  const qs = new URLSearchParams({
    name,
    size: String(stat.size),
    mimeType: guessMime(name),
    sha256,
  });
  const body = fs.readFileSync(absPath);
  const res = await fetch(`${base}/files/upload?${qs}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/octet-stream",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Relay 上传失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as UploadResult;
  return { ...json, size: stat.size, sha256, name };
}

/** 由 index.ts 注入，经当前 ws 连接发 file.offer（断线时随 pendingOutbound 缓冲） */
let offerSender: ((msg: WireMessage) => void) | undefined;

export function setOfferSender(fn: (msg: WireMessage) => void) {
  offerSender = fn;
}

/** 上传单个文件并给手机发 file.offer；返回 offer（失败抛错） */
export async function pushFileToPhone(
  cfg: AgentConfig,
  task: Pick<TaskCreatePayload, "taskId" | "sessionId">,
  absPath: string,
  onChunk?: ChunkHandler,
): Promise<FileOfferPayload> {
  const up = await uploadToRelay(cfg, absPath);
  const offer: FileOfferPayload = {
    fileId: up.fileId,
    taskId: task.taskId,
    sessionId: task.sessionId,
    name: up.name,
    size: up.size,
    mimeType: guessMime(up.name),
    sha256: up.sha256,
    url: up.url,
    expiresAt: up.expiresAt,
  };
  offerSender?.(createMessage("file.offer", "agent", offer));
  onChunk?.("info", `\n[文件已推送] ${up.name} (${fmtSize(up.size)})，请在手机端下载\n`);
  return offer;
}

/** 模式支持：`*.apk`（仅根目录）、`releases/*.apk`（指定目录）、
 * 双星前缀（任意层级，含根目录） */
function patternToRegex(pattern: string): RegExp {
  const norm = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const optionalDir = /^\*\*\//.test(norm);
  const rest = norm.replace(/^\*\*\//, "");
  const escaped = rest.replace(
    /[.+^${}()|[\]\\?*]/g,
    (ch) => (ch === "*" ? "[^/]*" : `\\${ch}`),
  );
  return new RegExp(`^${optionalDir ? "(?:.*/)?" : ""}${escaped}$`);
}

/** 任务完成后扫描工作区内新产生的匹配文件（默认任意层级 .apk），新→旧排序 */
export function scanNewArtifacts(
  cfg: AgentConfig,
  workspacePath: string,
  sinceTs: number,
): string[] {
  const conf = getFileOfferConfig(cfg);
  const regexes = conf.patterns.map(patternToRegex);
  const exclude = new Set(conf.excludeDirs);
  const maxBytes = conf.maxFileMb * 1024 * 1024;
  const hits: { p: string; mtime: number }[] = [];
  let visited = 0;

  const walk = (dir: string, depth: number) => {
    if (visited > 40000 || depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      visited++;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!exclude.has(e.name)) walk(full, depth + 1);
      } else if (e.isFile()) {
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.mtimeMs < sinceTs || st.size === 0 || st.size > maxBytes) continue;
        const rel = path.relative(workspacePath, full).replace(/\\/g, "/");
        if (regexes.some((re) => re.test(rel))) {
          hits.push({ p: full, mtime: st.mtimeMs });
        }
      }
    }
  };

  walk(workspacePath, 0);
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits.slice(0, conf.maxFiles).map((h) => h.p);
}

/** 任务成功结束后调用：推送工作区内新产物（如刚打好的 APK） */
export async function autoPushArtifacts(
  cfg: AgentConfig,
  task: TaskCreatePayload,
  workspacePath: string,
  taskStartedAt: number,
  onChunk: ChunkHandler,
): Promise<void> {
  const conf = getFileOfferConfig(cfg);
  if (!conf.enabled) return;
  // 构建产物 mtime 允许略早于任务开始（增量构建只 touch 部分文件）
  const since = taskStartedAt - 60_000;
  let files: string[];
  try {
    files = scanNewArtifacts(cfg, workspacePath, since);
  } catch {
    return;
  }
  for (const file of files) {
    try {
      await pushFileToPhone(cfg, task, file, onChunk);
    } catch (e) {
      onChunk("stderr", `\n[文件推送失败] ${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}
