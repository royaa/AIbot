import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig, McpConfig } from "../config.js";

export type McpServerConfig = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
};

export type McpCatalogEntry = {
  id: string;
  description?: string;
  targets?: string[];
  server: McpServerConfig;
};

export type McpCatalog = {
  version?: number;
  description?: string;
  servers?: McpCatalogEntry[];
};

export type SyncMcpOptions = {
  dryRun?: boolean;
  /** 只同步这些 target；默认全部 */
  targets?: string[];
  log?: (line: string) => void;
};

const agentRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalogPath = path.join(agentRoot, "mcp.catalog.json");
const runtimeConfigPath = path.join(agentRoot, "data", "mcp.runtime.json");

function ensureNodeExe() {
  if (process.env.NODE_EXE) return;
  try {
    process.env.NODE_EXE = execFileSync(
      process.platform === "win32" ? "where" : "which",
      ["node"],
      { encoding: "utf8" },
    )
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    process.env.NODE_EXE = process.execPath;
  }
}

function expandVars(input: string): string {
  return input.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_, key: string, def?: string) => {
    if (key === "HOME" || key === "USERPROFILE") return os.homedir();
    if (key === "CURSOR_HOME") return path.join(os.homedir(), ".cursor");
    if (key === "NODE_EXE") return process.env.NODE_EXE || process.execPath || def || "node";
    const fromEnv = process.env[key];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    return def ?? "";
  });
}

function maybeNormalizeFsPath(s: string): string {
  if (!s || s.includes("://")) return s;
  const home = os.homedir();
  if (
    s.startsWith(home) ||
    /^[A-Za-z]:[\\/]/.test(s) ||
    (s.startsWith("/") && !s.startsWith("/@"))
  ) {
    return path.normalize(s);
  }
  return s;
}

function expandDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandDeep(v);
    }
    return out;
  }
  if (typeof value === "string") return maybeNormalizeFsPath(expandVars(value));
  return value;
}

function readJson(file: string, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (e) {
    return fallback;
  }
}

function writeJson(
  file: string,
  data: unknown,
  dryRun: boolean,
  log: (s: string) => void,
) {
  const text = JSON.stringify(data, null, 2) + "\n";
  if (dryRun) {
    log(`[dry-run] write ${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  log(`[mcp] 已写入 ${file}`);
}

function mergeMcpServers(
  file: string,
  servers: Record<string, McpServerConfig>,
  dryRun: boolean,
  log: (s: string) => void,
) {
  const doc = readJson(file, {});
  const mcpServers =
    doc.mcpServers && typeof doc.mcpServers === "object"
      ? (doc.mcpServers as Record<string, unknown>)
      : {};
  doc.mcpServers = { ...mcpServers, ...servers };
  writeJson(file, doc, dryRun, log);
}

/**
 * 以"整块替换"方式维护 [mcp_servers.<id>] 区块（含其 .env 等子表）。
 * 旧正则版只替换到块内第一个子表头为止，导致每次同步叠加一份重复块、
 * 最终 config.toml 因重复定义 key 而 TOML 解析失败 —— 本函数同时会吞并历史重复副本。
 */
export function replaceCodexServerBlock(text: string, id: string, blockLines: string[]): string {
  const header = `[mcp_servers.${id}]`;
  const prefix = `[mcp_servers.${id}`;
  const isOwnedTable = (line: string) => {
    const t = line.trim();
    if (!t.startsWith(prefix)) return false;
    const next = t.slice(prefix.length);
    return next === "]" || next.startsWith(".") || next.startsWith("]");
  };
  const lines = text.split(/\r?\n/);
  // 逐个处理所有出现位置：第一处替换为新块，其余重复块整体删除
  let anchor = -1;
  let i = 0;
  const out: string[] = [];
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === header) {
      // 找到本块结束：下一个"不属于该 id 的表头"；找不到则延伸到文件尾
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j].trim();
        if (lj.startsWith("[") && !isOwnedTable(lines[j])) {
          end = j;
          break;
        }
      }
      if (anchor < 0) {
        anchor = out.length;
        out.push(...blockLines);
      }
      // anchor>=0 时：重复的历史副本直接丢弃
      i = end;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  if (anchor < 0) {
    while (out.length && !out[out.length - 1].trim()) out.pop();
    out.push(...blockLines);
  }
  return out.join("\n");
}

function mergeCodexToml(
  file: string,
  servers: Record<string, McpServerConfig>,
  dryRun: boolean,
  log: (s: string) => void,
) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [id, cfg] of Object.entries(servers)) {
    const lines = [`[mcp_servers.${id}]`];
    if (cfg.command) lines.push(`command = ${JSON.stringify(cfg.command)}`);
    if (Array.isArray(cfg.args)) lines.push(`args = ${JSON.stringify(cfg.args)}`);
    if (cfg.cwd) lines.push(`cwd = ${JSON.stringify(cfg.cwd)}`);
    if (cfg.env && typeof cfg.env === "object") {
      lines.push(`[mcp_servers.${id}.env]`);
      for (const [ek, ev] of Object.entries(cfg.env)) {
        lines.push(`${ek} = ${JSON.stringify(String(ev))}`);
      }
    }
    text = replaceCodexServerBlock(text, id, lines);
  }
  if (dryRun) {
    log(`[dry-run] write ${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n", "utf8");
  log(`[mcp] 已写入 ${file}`);
}

export function getMcpConfig(cfg: AgentConfig): McpConfig {
  return {
    autoSync: true,
    injectClaude: true,
    ...cfg.mcp,
  };
}

export function loadMcpCatalog(): McpCatalog | null {
  if (!fs.existsSync(catalogPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(catalogPath, "utf8")) as McpCatalog;
  } catch {
    return null;
  }
}

/** 解析清单：target → serverId → config */
export function resolveMcpServersByTarget(
  onlyTargets?: string[] | null,
): Record<string, Record<string, McpServerConfig>> {
  ensureNodeExe();
  const catalog = loadMcpCatalog();
  const byTarget: Record<string, Record<string, McpServerConfig>> = {
    cursor: {},
    claude: {},
    codex: {},
  };
  if (!catalog?.servers?.length) return byTarget;

  const filter = onlyTargets?.length
    ? new Set(onlyTargets.map((s) => s.trim()).filter(Boolean))
    : null;

  for (const entry of catalog.servers) {
    if (!entry?.id || !entry.server) continue;
    const expanded = expandDeep(entry.server) as McpServerConfig;
    for (const t of entry.targets ?? []) {
      if (filter && !filter.has(t)) continue;
      if (!byTarget[t]) continue;
      byTarget[t][entry.id] = expanded;
    }
  }
  return byTarget;
}

/**
 * 写入 Claude 会话用的运行时 MCP 配置文件，返回路径。
 * 供 `claude --mcp-config <path>` 使用，任务级立即生效。
 */
export function writeClaudeRuntimeMcpConfig(log?: (s: string) => void): string | null {
  const servers = resolveMcpServersByTarget(["claude"]).claude;
  if (Object.keys(servers).length === 0) return null;
  const doc = { mcpServers: servers };
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
  fs.writeFileSync(runtimeConfigPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  log?.(`[mcp] Claude 运行时配置: ${runtimeConfigPath}`);
  return runtimeConfigPath;
}

/** 把清单投影到本机 Claude / Cursor / Codex 配置 */
export function syncMcpCatalog(options: SyncMcpOptions = {}): {
  ok: boolean;
  message: string;
} {
  const log = options.log ?? console.log;
  const dryRun = options.dryRun === true;
  if (!fs.existsSync(catalogPath)) {
    return { ok: false, message: `找不到 ${catalogPath}` };
  }

  const byTarget = resolveMcpServersByTarget(options.targets ?? null);
  const home = os.homedir();
  let wrote = 0;

  if (Object.keys(byTarget.cursor).length) {
    mergeMcpServers(
      path.join(home, ".cursor", "mcp.json"),
      byTarget.cursor,
      dryRun,
      log,
    );
    wrote++;
  }

  if (Object.keys(byTarget.claude).length) {
    const claudeJson = path.join(home, ".claude.json");
    const claudeSettings = path.join(home, ".claude", "settings.json");
    const primary = fs.existsSync(claudeJson) ? claudeJson : claudeSettings;
    mergeMcpServers(primary, byTarget.claude, dryRun, log);
    wrote++;
  }

  if (Object.keys(byTarget.codex).length) {
    mergeCodexToml(
      path.join(home, ".codex", "config.toml"),
      byTarget.codex,
      dryRun,
      log,
    );
    wrote++;
  }

  // 同步刷新 Claude 运行时文件，供 spawn 注入
  if (!dryRun) writeClaudeRuntimeMcpConfig(log);

  const message =
    wrote === 0
      ? "MCP 清单为空或无匹配 target"
      : dryRun
        ? "dry-run 完成"
        : "公共 MCP 已投影到本机 CLI 配置（Claude 任务另经 --mcp-config 立即生效）";
  log(`[mcp] ${message}`);
  return { ok: true, message };
}

/** Agent 启动时调用：默认自动同步 */
export function autoSyncMcpOnStartup(cfg: AgentConfig): void {
  const mcp = getMcpConfig(cfg);
  if (mcp.autoSync === false) {
    console.log("[mcp] autoSync=false，跳过启动投影");
    return;
  }
  try {
    const result = syncMcpCatalog({ log: (s) => console.log(s) });
    if (!result.ok) console.warn(`[mcp] ${result.message}`);
  } catch (e) {
    console.warn(
      `[mcp] 自动投影失败（不影响 Agent 启动）: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
