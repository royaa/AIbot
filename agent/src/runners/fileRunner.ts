import fs from "node:fs";
import path from "node:path";
import type { TaskCreatePayload } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { assertPathInWorkspace } from "../config.js";
import { fmtSize, pushFileToPhone } from "../filePush.js";
import type { ChunkHandler, RunnerResult } from "./spawnUtil.js";

/**
 * 手机「取文件」工具：prompt 填工作区内相对路径（如 releases/app.apk），
 * Agent 上传到 Relay 并推送 file.offer，手机端即可下载。
 */
export async function runFile(
  cfg: AgentConfig,
  cwd: string,
  task: TaskCreatePayload,
  onChunk: ChunkHandler,
): Promise<RunnerResult> {
  const rel = task.prompt.trim().replace(/^["']|["']$/g, "");
  if (!rel) {
    onChunk("stderr", "请输入工作区内的相对文件路径，例如 releases/app.apk\n");
    return { exitCode: 1 };
  }
  const abs = path.resolve(cwd, rel);
  try {
    assertPathInWorkspace(cwd, abs);
  } catch (e) {
    onChunk("stderr", `${e instanceof Error ? e.message : String(e)}\n`);
    return { exitCode: 1 };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    onChunk("stderr", `文件不存在: ${rel}\n`);
    return { exitCode: 1 };
  }
  if (stat.isDirectory()) {
    onChunk("stderr", `是目录不是文件，请指定具体文件: ${rel}\n`);
    return { exitCode: 1 };
  }
  onChunk("info", `正在上传 ${rel} (${fmtSize(stat.size)}) 到 Relay…\n`);
  try {
    await pushFileToPhone(cfg, task, abs, onChunk);
    return { exitCode: 0 };
  } catch (e) {
    onChunk("stderr", `推送失败: ${e instanceof Error ? e.message : String(e)}\n`);
    return { exitCode: 1 };
  }
}
