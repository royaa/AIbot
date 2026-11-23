import iconv from "iconv-lite";

export type ChunkHandler = (
  kind: "stdout" | "stderr" | "info" | "markdown",
  text: string,
) => void;

export type OutputEncoding = "auto" | "utf8" | "gbk";

/**
 * 解码子进程输出。
 * - Cursor / Claude / Node 等现代 CLI 输出 UTF-8
 * - Windows 下 SVN 等原生控制台多为 GBK
 * auto：先按 UTF-8；若出现替换符再回退 GBK（避免把 UTF-8 中文误当 GBK 解成乱码）
 */
export function decodeProcessOutput(
  buf: Buffer,
  encoding: OutputEncoding = "auto",
): string {
  if (encoding === "utf8" || process.platform !== "win32") {
    return buf.toString("utf8");
  }
  if (encoding === "gbk") {
    return iconv.decode(buf, "gbk");
  }
  const asUtf8 = buf.toString("utf8");
  if (!asUtf8.includes("\uFFFD")) {
    return asUtf8;
  }
  return iconv.decode(buf, "gbk");
}
