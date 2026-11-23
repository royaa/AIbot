import fs from "node:fs";
import path from "node:path";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  decodeProcessOutput,
  type ChunkHandler,
  type OutputEncoding,
} from "./decodeOutput.js";

export type { ChunkHandler, OutputEncoding } from "./decodeOutput.js";

export type RunResult = { exitCode: number };

export type RunnerResult = { exitCode: number; nativeSessionId?: string };

/** Node spawn 找不到 PATH 里的 npm *.ps1，需解析为绝对路径 */
export function resolveExecutable(executable: string): string {
  if (path.isAbsolute(executable) || executable.includes("/") || executable.includes("\\")) {
    return executable;
  }
  if (path.extname(executable)) return executable;
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  for (const dir of pathEnv.split(";")) {
    const d = dir.trim();
    if (!d) continue;
    for (const ext of [".exe", ".cmd", ".bat", ".ps1"]) {
      const candidate = path.join(d, executable + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return executable;
}

export type SpawnToolOptions = {
  detachedGui?: boolean;
  /** 子进程 stdout/stderr 编码；默认 auto（优先 UTF-8） */
  encoding?: OutputEncoding;
  /** 覆盖子进程环境变量，用于给个别 CLI 补代理等 */
  env?: NodeJS.ProcessEnv;
};

/** Windows 下对 .ps1 / .cmd 使用 powershell 或 cmd 包装 */
export function spawnTool(
  executable: string,
  args: string[],
  cwd: string,
  onChunk: ChunkHandler,
  signal?: AbortSignal,
  opts?: SpawnToolOptions,
): { proc: ChildProcess; done: Promise<RunResult> } {
  executable = resolveExecutable(executable);
  const ext = path.extname(executable).toLowerCase();
  let cmd = executable;
  let spawnArgs = args;

  if (ext === ".ps1") {
    cmd = "powershell.exe";
    spawnArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, ...args];
  } else if (ext === ".cmd" || ext === ".bat") {
    cmd = "cmd.exe";
    spawnArgs = ["/c", executable, ...args];
  }

  const env = { ...process.env, ...opts?.env };
  if (opts?.detachedGui) {
    const proc = spawn(cmd, spawnArgs, {
      cwd,
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    proc.unref();
    const done = Promise.resolve({ exitCode: 0 });
    return { proc: proc as ChildProcessWithoutNullStreams, done };
  }

  // stdin 必须 ignore：Codex/部分 CLI 在检测到 pipe 且未 EOF 时会一直
  // 「Reading additional input from stdin...」导致 App 端任务无响应。
  const proc = spawn(cmd, spawnArgs, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const abort = () => {
    if (!proc.killed) {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    }
  };
  signal?.addEventListener("abort", abort, { once: true });

  const encoding = opts?.encoding ?? "auto";
  proc.stdout!.on("data", (b) =>
    onChunk("stdout", decodeProcessOutput(b as Buffer, encoding)),
  );
  proc.stderr!.on("data", (b) =>
    onChunk("stderr", decodeProcessOutput(b as Buffer, encoding)),
  );

  const done = new Promise<RunResult>((resolve) => {
    proc.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      onChunk("stderr", `${err.message}\n`);
      resolve({ exitCode: 1 });
    });
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      resolve({ exitCode: code ?? 1 });
    });
  });

  return { proc, done };
}
