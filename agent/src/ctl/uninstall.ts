import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentCore } from "../core.js";
import { resolveExecutable } from "../runners/spawnUtil.js";
import { getProbeSpec } from "./probe.js";

/** 只允许删这些 CLI 自己的安装，避免误删 Chrome / IDE */
const ALLOWED = new Set([
  "claude",
  "agent",
  "codex",
  "opencode",
  "pi",
  "droid",
  "crush",
  "grok",
  "dsh",
]);

const NPM_PKG: Record<string, string> = {
  opencode: "opencode-ai",
  pi: "@earendil-works/pi-coding-agent",
  crush: "@charmland/crush",
  codex: "@openai/codex",
};

function underHome(file: string): string {
  const abs = path.resolve(file);
  const rel = path.relative(os.homedir(), abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`拒绝删除用户目录以外的文件：${abs}`);
  }
  return abs;
}

function isNpmShim(file: string): boolean {
  const norm = file.replace(/\//g, "\\").toLowerCase();
  return norm.includes("\\npm\\");
}

/** 独立安装目录可以整目录删；共享的 .local\\bin 只删文件本身 */
function installRoot(file: string): string | null {
  const dir = path.dirname(file);
  const base = path.basename(dir).toLowerCase();
  if (base === "cursor-agent" || base === "claudecode") return dir;
  if (base === "bin") {
    const parent = path.dirname(dir);
    const name = path.basename(parent).toLowerCase();
    if (name === ".factory" || name === "codex" || name === "claude") return parent;
  }
  return null;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: true });
    let err = "";
    child.stderr?.on("data", (b: Buffer) => {
      err += b.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error((err || `退出码 ${code ?? "null"}`).trim().slice(0, 500)));
    });
  });
}

/**
 * 删除本机 CLI 安装（用户目录内的文件或 npm 全局包），并清空 agent 配置里的路径。
 */
export async function uninstallCli(
  core: AgentCore,
  id: string,
): Promise<{ ok: true; removed: string }> {
  if (!ALLOWED.has(id)) throw new Error("这个工具不能从这里删除");
  const spec = getProbeSpec(id);
  if (!spec) throw new Error(`未知 CLI: ${id}`);
  const configured = core.cfg.tools[spec.cfgKey]?.trim() ?? "";
  if (!configured) throw new Error("没有已配置的安装路径");

  let removed = configured;
  try {
    const resolved = underHome(resolveExecutable(configured));
    removed = resolved;
    if (fs.existsSync(resolved)) {
      if (isNpmShim(resolved) && NPM_PKG[id]) {
        core.log("info", `[uninstall] npm uninstall -g ${NPM_PKG[id]}`);
        await run("npm", ["uninstall", "-g", NPM_PKG[id]]);
      } else {
        const root = installRoot(resolved);
        const target = root ?? resolved;
        core.log("info", `[uninstall] 删除 ${target}`);
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }

  core.applyConfigPatch({ tools: { [spec.cfgKey]: "" } });
  core.notifyToolsChanged();
  core.log("info", `[uninstall] 已移除 ${spec.label}`);
  return { ok: true, removed };
}
