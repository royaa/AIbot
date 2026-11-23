import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./paths.js";

/** 进程若在这段时间内退出，视为启动失败并把日志带回界面 */
const BOOT_MS = 1500;

function tailLog(file: string): string {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return "";
    return text.split(/\r?\n/).slice(-8).join("\n");
  } catch {
    return "";
  }
}

/**
 * 以独立子进程方式启动 Agent（detached，崩溃隔离），输出追加到 agent/logs/client-start.log。
 * 运行时 = 本进程的可执行文件 + ELECTRON_RUN_AS_NODE=1：
 * - 开发态即 electron.exe，打包态即安装的 AI Bot Console.exe（自带 Node，目标机无需装 Node）
 * 入口缺失或进程马上退出时 reject，避免界面停在「启动 Agent」却没有任何说明。
 */
export function startAgent(): Promise<void> {
  const entry = path.join(agentDir, "dist", "index.js");
  if (!fs.existsSync(entry)) {
    return Promise.reject(new Error(`找不到 Agent 程序：${entry}`));
  }
  const logDir = path.join(agentDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "client-start.log");
  const fd = fs.openSync(logFile, "a");

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let settled = false;
    let fdClosed = false;
    const closeFd = () => {
      if (fdClosed) return;
      fdClosed = true;
      try {
        fs.closeSync(fd);
      } catch {
        /* 句柄已关 */
      }
    };
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      closeFd();
      if (err) reject(err);
      else resolve();
    };

    try {
      child = spawn(process.execPath, [entry], {
        cwd: agentDir,
        detached: true,
        stdio: ["ignore", fd, fd],
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
    } catch (e) {
      done(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const timer = setTimeout(() => {
      child.unref();
      done();
    }, BOOT_MS);

    child.once("error", (err) => {
      clearTimeout(timer);
      done(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      closeFd();
      const tail = tailLog(logFile);
      done(
        new Error(
          `Agent 启动后立即退出（code=${code ?? "null"}）${tail ? `\n${tail}` : ""}`,
        ),
      );
    });
  });
}

/** 优雅停止：经控制通道下发 agent.stop，Agent 自行退出（会先清理 ctl.json） */
export function stopAgentByCtl(request: (t: string, p?: unknown) => Promise<unknown>): Promise<unknown> {
  return request("agent.stop");
}
