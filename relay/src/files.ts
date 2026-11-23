import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken } from "./auth.js";

/**
 * 大文件（APK 等）不走 ws，走本模块的 HTTP 通道：
 *   Agent  POST /files/upload（Bearer agent JWT，application/octet-stream 流式上传）
 *   手机   GET  /files/:fileId?t=<一次性 token>（支持 Range 断点续传）
 * ws 只推送几百字节的 file.offer 通知。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const filesDir =
  process.env.FILES_DIR ?? path.join(here, "..", "data", "files");
const ttlMs = Math.max(1, Number(process.env.FILES_TTL_HOURS ?? 24)) * 3600_000;
const maxFileBytes =
  Math.max(1, Number(process.env.MAX_FILE_MB ?? 500)) * 1024 * 1024;
export { maxFileBytes };

type FileMeta = {
  fileId: string;
  agentId: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  /** 一次性下载 token（随 meta 持久化，Relay 重启后 URL 仍有效） */
  token: string;
  createdAt: number;
  expiresAt: number;
};

const metas = new Map<string, FileMeta>();
const tokens = new Map<string, string>(); // token → fileId

const binPath = (fileId: string) => path.join(filesDir, `${fileId}.bin`);
const metaPath = (fileId: string) => path.join(filesDir, `${fileId}.json`);

function removeFile(meta: FileMeta) {
  metas.delete(meta.fileId);
  tokens.delete(meta.token);
  for (const p of [binPath(meta.fileId), metaPath(meta.fileId)]) {
    fs.promises.unlink(p).catch(() => {});
  }
}

/** 启动时加载历史 meta、清掉已过期文件（磁盘上无 meta 的孤儿 .bin 一并删除） */
export function initFiles() {
  fs.mkdirSync(filesDir, { recursive: true });
  const now = Date.now();
  let loaded = 0;
  let dropped = 0;
  for (const entry of fs.readdirSync(filesDir)) {
    const full = path.join(filesDir, entry);
    if (entry.endsWith(".json")) {
      try {
        const meta = JSON.parse(
          fs.readFileSync(full, "utf8"),
        ) as FileMeta;
        if (meta.expiresAt < now || !fs.existsSync(binPath(meta.fileId))) {
          removeFile(meta);
          dropped++;
        } else {
          metas.set(meta.fileId, meta);
          tokens.set(meta.token, meta.fileId);
          loaded++;
        }
      } catch {
        fs.promises.unlink(full).catch(() => {});
      }
    } else if (entry.endsWith(".bin")) {
      const fileId = entry.slice(0, -4);
      if (!metas.has(fileId)) fs.promises.unlink(full).catch(() => {});
    }
  }
  if (loaded || dropped) {
    console.log(`[files] 恢复 ${loaded} 个待下载文件，清理 ${dropped} 个过期文件`);
  }
}

export function startFileCleanupTimer() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const meta of [...metas.values()]) {
      if (meta.expiresAt < now) removeFile(meta);
    }
  }, 10 * 60_000);
  timer.unref?.();
}

function requireAgentAuth(req: FastifyRequest): string | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return null;
  try {
    const claims = verifyToken(token);
    return claims.role === "agent" && claims.agentId ? claims.agentId : null;
  } catch {
    return null;
  }
}

/**
 * POST /files/upload?name=…&size=…&mimeType=…&sha256=…
 * Body: application/octet-stream（流式写盘，超过 MAX_FILE_MB 中止）
 */
export async function handleUpload(req: FastifyRequest, reply: FastifyReply) {
  const agentId = requireAgentAuth(req);
  if (!agentId) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const q = req.query as Record<string, string>;
  const name = (q.name ?? "file").slice(0, 200);
  const size = Number(q.size ?? 0);
  const mimeType = q.mimeType ?? "application/octet-stream";
  const expectSha = q.sha256 ?? "";
  if (!Number.isFinite(size) || size <= 0 || size > maxFileBytes) {
    return reply.code(400).send({
      error: "bad_size",
      message: `size 必须在 1~${maxFileBytes} 字节之间`,
    });
  }

  const fileId = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString("hex");
  const abs = binPath(fileId);
  const hash = crypto.createHash("sha256");
  let written = 0;
  const out = fs.createWriteStream(abs);
  let writeError: Error | undefined;
  out.on("error", (e) => {
    writeError = e;
  });

  try {
    // body 为透传的原始流（见 index.ts addContentTypeParser）
    const body = req.body as unknown as AsyncIterable<Buffer>;
    for await (const chunk of body) {
      if (writeError) throw writeError;
      written += chunk.length;
      if (written > maxFileBytes) throw new Error("exceeds_max_size");
      hash.update(chunk);
      if (!out.write(chunk)) {
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      }
    }
    if (writeError) throw writeError;
    await new Promise<void>((resolve) => out.end(() => resolve()));
  } catch (e) {
    out.destroy();
    fs.promises.unlink(abs).catch(() => {});
    return reply.code(400).send({
      error: "upload_failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const sha256 = hash.digest("hex");
  if (expectSha && expectSha.toLowerCase() !== sha256) {
    fs.promises.unlink(abs).catch(() => {});
    return reply.code(400).send({ error: "sha256_mismatch" });
  }
  if (written !== size) {
    fs.promises.unlink(abs).catch(() => {});
    return reply.code(400).send({
      error: "size_mismatch",
      message: `声明 ${size}，实收 ${written}`,
    });
  }

  const now = Date.now();
  const meta: FileMeta = {
    fileId,
    agentId,
    name,
    size,
    mimeType,
    sha256,
    token,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  metas.set(fileId, meta);
  tokens.set(token, fileId);
  fs.writeFileSync(
    metaPath(fileId),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  reply.send({
    fileId,
    url: `/files/${fileId}?t=${token}`,
    size,
    sha256,
    expiresAt: meta.expiresAt,
  });
}

/** GET /files/:fileId?t=…（支持 Range 断点续传） */
export async function handleDownload(req: FastifyRequest, reply: FastifyReply) {
  const { fileId } = req.params as { fileId: string };
  const q = req.query as Record<string, string>;
  const token = q.t ?? "";
  const meta = metas.get(fileId);
  if (!meta || tokens.get(token) !== fileId) {
    return reply.code(404).send({ error: "not_found" });
  }
  if (meta.expiresAt < Date.now()) {
    removeFile(meta);
    return reply.code(410).send({ error: "expired" });
  }
  const abs = binPath(fileId);
  if (!fs.existsSync(abs)) {
    return reply.code(404).send({ error: "not_found" });
  }

  const asciiName = meta.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  reply
    .code(200)
    .header("content-type", meta.mimeType)
    .header("content-disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`)
    .header("accept-ranges", "bytes")
    .header("x-file-sha256", meta.sha256);

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== "" || m[2] !== "")) {
      let start: number;
      let end: number;
      if (m[1] === "") {
        // suffix range: bytes=-N → 最后 N 字节
        const n = Math.min(Number(m[2]), meta.size);
        start = meta.size - n;
        end = meta.size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === "" ? meta.size - 1 : Math.min(Number(m[2]), meta.size - 1);
      }
      if (start >= meta.size || start > end) {
        // 注意：async handler 里必须 return reply，否则 Fastify v5 会把
        // 尚未完成的流响应当成空 payload 收口（content-length: 0）
        return reply
          .code(416)
          .header("content-range", `bytes */${meta.size}`)
          .send();
      }
      return reply
        .code(206)
        .header("content-range", `bytes ${start}-${end}/${meta.size}`)
        .header("content-length", String(end - start + 1))
        .send(fs.createReadStream(abs, { start, end }));
    }
  }
  return reply
    .header("content-length", String(meta.size))
    .send(fs.createReadStream(abs));
}
