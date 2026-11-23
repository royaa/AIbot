import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  CliInstallDoneEvent,
  CliInstallOutputEvent,
  CliInstallStartAck,
  CliInstallTarget,
} from "@grokbot/protocol";
import type { AgentCore } from "../core.js";
import { decodeProcessOutput } from "../runners/decodeOutput.js";

const agentRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const repoRoot = path.resolve(agentRoot, "..");
const scriptDir = path.join(repoRoot, "scripts", "install-cli");

/** 已安装时「更新」走的命令；跑完再以 -SkipInstall 把路径写回配置 */
const UPDATE_CMD: Partial<Record<CliInstallTarget, string>> = {
  claude: "irm https://claude.ai/install.ps1 | iex",
  cursorAgent: "irm 'https://cursor.com/install?win32=true' | iex",
  codex: "irm https://chatgpt.com/codex/install.ps1 | iex",
  opencode: "npm install -g opencode-ai",
  pi: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
  droid: "irm https://app.factory.ai/cli/windows | iex",
  crush: "npm install -g @charmland/crush",
};

const SCRIPTS: Record<CliInstallTarget, string> = {
  all: "install-all.ps1",
  claude: "install-claude.ps1",
  cursorAgent: "install-cursor-agent.ps1",
  codex: "install-codex.ps1",
  workbuddy: "install-workbuddy.ps1",
  opencode: "install-opencode.ps1",
  pi: "install-pi.ps1",
  droid: "install-droid.ps1",
  crush: "install-crush.ps1",
};

type Running = {
  target: CliInstallTarget;
  child: ReturnType<typeof spawn>;
  startedAt: number;
};

let current: Running | null = null;

export function getRunningInstall():
  | { target: CliInstallTarget; startedAt: number }
  | null {
  return current ? { target: current.target, startedAt: current.startedAt } : null;
}

/**
 * 执行 scripts/install-cli 下的 PowerShell 安装脚本，输出以事件流回传。
 * 同一时间只允许一个安装任务（脚本本身会写 agent.config.json）。
 */
export function startInstall(
  core: AgentCore,
  target: CliInstallTarget,
  emit: (ev: CliInstallOutputEvent | CliInstallDoneEvent) => void,
  opts?: { update?: boolean },
): CliInstallStartAck {
  if (current) {
    return {
      started: false,
      alreadyRunning: { target: current.target, startedAt: current.startedAt },
    };
  }
  const script = path.join(scriptDir, SCRIPTS[target]);
  if (!fs.existsSync(script)) {
    throw new Error(`安装脚本不存在: ${script}`);
  }

  const updateCmd = opts?.update ? UPDATE_CMD[target] : undefined;
  const child = spawn(
    "powershell.exe",
    updateCmd
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", updateCmd]
      : ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      cwd: repoRoot,
      env: { ...process.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  current = { target, child, startedAt: Date.now() };
  core.log("info", `[install] 开始${opts?.update ? "更新" : "安装"}: ${target}`);

  const emitLines = (stream: "stdout" | "stderr", text: string, state: { buf: string }) => {
    state.buf += text;
    const lines = state.buf.split(/\r?\n/);
    state.buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev: CliInstallOutputEvent = {
        target,
        stream,
        line: line.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 4000),
        ts: Date.now(),
      };
      emit(ev);
    }
  };

  const outState = { buf: "" };
  const errState = { buf: "" };
  child.stdout?.on("data", (b: Buffer) =>
    emitLines("stdout", decodeProcessOutput(b, "auto"), outState),
  );
  child.stderr?.on("data", (b: Buffer) =>
    emitLines("stderr", decodeProcessOutput(b, "auto"), errState),
  );

  child.on("error", (err) => {
    core.log("error", `[install] 启动失败: ${err.message}`);
    const ev: CliInstallDoneEvent = {
      target,
      exitCode: 1,
      ok: false,
    };
    current = null;
    emit(ev);
  });

  const finish = (exitCode: number) => {
    current = null;
    // 安装脚本会直接改写 agent.config.json → 从磁盘重载并热生效
    if (exitCode === 0) {
      try {
        core.reloadFromDisk();
        core.notifyToolsChanged();
      } catch (e) {
        core.log(
          "warn",
          `[install] 重载配置失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    core.log(
      exitCode === 0 ? "info" : "error",
      `[install] ${target} 结束，exitCode=${exitCode}`,
    );
    const ev: CliInstallDoneEvent = { target, exitCode, ok: exitCode === 0 };
    emit(ev);
  };

  child.on("close", (code) => {
    const exitCode = code ?? 1;
    // 更新命令装完后，用原脚本只回写路径（脚本在已安装时不会重复下载）
    if (exitCode === 0 && updateCmd && target !== "workbuddy") {
      const follow = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-SkipInstall"],
        {
          cwd: repoRoot,
          env: { ...process.env },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const followOut = { buf: "" };
      const followErr = { buf: "" };
      follow.stdout?.on("data", (b: Buffer) =>
        emitLines("stdout", decodeProcessOutput(b, "auto"), followOut),
      );
      follow.stderr?.on("data", (b: Buffer) =>
        emitLines("stderr", decodeProcessOutput(b, "auto"), followErr),
      );
      let followSettled = false;
      const followDone = (code2: number | null) => {
        if (followSettled) return;
        followSettled = true;
        if ((code2 ?? 1) !== 0) {
          core.log("warn", `[install] 更新已完成，回写路径失败 exitCode=${code2}`);
        }
        finish(0);
      };
      follow.on("error", () => followDone(1));
      follow.on("close", (code2) => followDone(code2));
      return;
    }
    finish(exitCode);
  });

  return { started: true };
}
