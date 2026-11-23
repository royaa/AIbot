import fs from "node:fs";
import path from "node:path";
import type { CliProbeItem } from "@grokbot/protocol";
import type { AgentConfig } from "../config.js";
import { resolveExecutable, spawnTool } from "../runners/spawnUtil.js";

type ProbeSpec = {
  id: string;
  label: string;
  /** agent.config → tools.* 键 */
  cfgKey: string;
  /** 提供 → 额外执行 `--version` 探活（.ps1 不执行） */
  versionArgs?: string[];
  loginHint?: string;
};

/** 与 tools/registry.ts 的主入口保持对应（hostKind=cli 的部分） */
const SPECS: ProbeSpec[] = [
  {
    id: "claude",
    label: "Claude",
    cfgKey: "claude",
    versionArgs: ["--version"],
    loginHint: "终端运行 claude 并按提示登录",
  },
  {
    id: "agent",
    label: "Cursor Agent",
    cfgKey: "agent",
    loginHint: "终端运行 agent login 登录",
  },
  {
    id: "codex",
    label: "Codex",
    cfgKey: "codex",
    versionArgs: ["--version"],
    loginHint: "API Key 可在「CLI 配置」写入（BigModel 端点 + Key）",
  },
  {
    id: "opencode",
    label: "OpenCode",
    cfgKey: "opencode",
    versionArgs: ["--version"],
    loginHint: "API Key 可在「CLI 配置」写入；或运行 opencode auth login 选 Zhipu AI Coding Plan",
  },
  {
    id: "pi",
    label: "Pi Coding Agent",
    cfgKey: "pi",
    versionArgs: ["--version"],
    loginHint: "API Key 可在「CLI 配置」写入（环境变量）；或运行 pi 后执行 /login zai-coding-cn",
  },
  {
    id: "droid",
    label: "Droid",
    cfgKey: "droid",
    versionArgs: ["--version"],
    loginHint: "BYOK 密钥在「CLI 配置」写入；首次运行 droid 还需浏览器登录 Factory 账户（海外手机号）",
  },
  {
    id: "crush",
    label: "Crush",
    cfgKey: "crush",
    versionArgs: ["--version"],
    loginHint: "API Key 可在「CLI 配置」写入；启动后 /models 选 GLM 模型",
  },
  {
    id: "grok",
    label: "Grok",
    cfgKey: "grok",
    versionArgs: ["--version"],
    loginHint: "无需登录，配置 API Key 即可（见 CLI 配置页）",
  },
  {
    id: "workbuddy",
    label: "WorkBuddy",
    cfgKey: "chrome",
    loginHint: "首次任务弹出的 Chrome 里登录一次 workbuddy.cn",
  },
  { id: "dsh", label: "DSH", cfgKey: "dsh" },
  { id: "cursor", label: "Cursor IDE", cfgKey: "cursor" },
  { id: "svn", label: "SVN", cfgKey: "svn", versionArgs: ["--version"] },
];

const VERSION_TIMEOUT_MS = 8000;

/** 探测 id → App 对话工具 id。没有执行器的安装项不会进手机列表 */
const REGISTRY_ID: Record<string, string> = {
  claude: "claude",
  agent: "cursor_agent",
  codex: "codex",
  grok: "grok",
  workbuddy: "workbuddy",
  dsh: "dsh",
};

export function getProbeSpec(id: string): ProbeSpec | undefined {
  return SPECS.find((s) => s.id === id);
}

/** 配置路径真实存在的对话 CLI（不含版本探测，避免拖慢状态上报） */
export function installedRegistryIds(cfg: AgentConfig): Set<string> {
  const ids = new Set<string>();
  for (const spec of SPECS) {
    const toolId = REGISTRY_ID[spec.id];
    if (!toolId) continue;
    const configured = cfg.tools[spec.cfgKey]?.trim() ?? "";
    if (!configured) continue;
    try {
      const resolved = resolveExecutable(configured);
      const isPathLike =
        path.isAbsolute(resolved) || resolved.includes("/") || resolved.includes("\\");
      if (isPathLike && fs.existsSync(resolved)) ids.add(toolId);
    } catch {
      /* 路径解析失败视为未安装 */
    }
  }
  return ids;
}

/** 探测各 CLI 安装状态；ids 为空则全部 */
export async function probeCliTools(
  cfg: AgentConfig,
  ids?: string[],
): Promise<CliProbeItem[]> {
  const specs = ids && ids.length > 0 ? SPECS.filter((s) => ids.includes(s.id)) : SPECS;
  return Promise.all(specs.map((spec) => probeOne(cfg, spec)));
}

async function probeOne(cfg: AgentConfig, spec: ProbeSpec): Promise<CliProbeItem> {
  const configured = cfg.tools[spec.cfgKey]?.trim() ?? "";
  const item: CliProbeItem = {
    id: spec.id,
    label: spec.label,
    cfgKey: spec.cfgKey,
    configured,
    installed: false,
    loginHint: spec.loginHint,
  };
  if (!configured) return item;

  try {
    const resolved = resolveExecutable(configured);
    item.resolved = resolved;
    const isPathLike =
      path.isAbsolute(resolved) || resolved.includes("/") || resolved.includes("\\");
    const exists = isPathLike ? fs.existsSync(resolved) : false;
    if (!exists) {
      item.probeError = `路径不存在: ${resolved}`;
      return item;
    }
    item.installed = true;

    if (spec.versionArgs && path.extname(resolved).toLowerCase() !== ".ps1") {
      const version = await probeVersion(resolved, spec.versionArgs);
      if (version) item.version = version;
    }
  } catch (e) {
    item.probeError = e instanceof Error ? e.message : String(e);
  }
  return item;
}

function probeVersion(executable: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (v?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ac.abort();
      const first = (v ?? "").trim().split(/\r?\n/)[0] ?? "";
      resolve(first ? first.slice(0, 100) : undefined);
    };
    const ac = new AbortController();
    const timer = setTimeout(() => finish(out), VERSION_TIMEOUT_MS);
    try {
      const { done } = spawnTool(
        executable,
        args,
        process.cwd(),
        (_kind, text) => {
          out += text;
        },
        ac.signal,
      );
      void done.then((r) => finish(r.exitCode === 0 ? out : undefined));
    } catch {
      finish(undefined);
    }
  });
}
