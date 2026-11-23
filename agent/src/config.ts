import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Workspace = { id: string; name: string; path: string };

export type SessionConfig = {
  maxContextChars?: number;
  keepRecentTurns?: number;
  summarizeTool?: string;
  nativeResume?: Record<string, boolean>;
};

export type FileOfferConfig = {
  /** 任务完成后自动扫描推送新产物；关掉则只能用「取文件」工具手动推 */
  enabled?: boolean;
  /** 工作区内新增产物的匹配模式（相对路径，支持 * 与 ** 前缀） */
  patterns?: string[];
  excludeDirs?: string[];
  /** 单次任务最多推送文件数 */
  maxFiles?: number;
  /** 单文件大小上限 */
  maxFileMb?: number;
};

/** 公共技能注入：扫描 agent/skills 下各子目录的 SKILL.md */
export type SkillsConfig = {
  /** 默认 true；false 关闭全部技能注入 */
  enabled?: boolean;
  /** 非空时只加载这些 skill-id */
  include?: string[];
  /** 始终跳过的 skill-id */
  exclude?: string[];
};

/** 公共 MCP：投影到本机 CLI，不在 Agent 内托管 */
export type McpConfig = {
  /** 默认 true：Agent 启动时自动把 mcp.catalog.json 写入各 CLI 配置 */
  autoSync?: boolean;
  /** 默认 true：Claude 任务带 --mcp-config，当次会话立即生效 */
  injectClaude?: boolean;
};

export type AgentConfig = {
  agentId: string;
  relayUrl: string;
  token: string;
  workspaces: Workspace[];
  tools: Record<string, string>;
  session?: SessionConfig;
  fileOffer?: FileOfferConfig;
  skills?: SkillsConfig;
  mcp?: McpConfig;
  /**
   * 手机遥控场景默认 true：不再把确认推到 App，
   * 并由各 CLI runner 自动带上放行参数（Claude skip permissions / Cursor --force）。
   * 设为 false 可恢复二次确认。
   */
  autoApprove?: boolean;
};

/** 默认自动同意，减少手机端交互 */
export function isAutoApprove(cfg: AgentConfig): boolean {
  return cfg.autoApprove !== false;
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(dir, "..", "agent.config.json");
const localPath = path.join(dir, "..", "agent.config.local.json");

export function loadConfig(): AgentConfig {
  const base = JSON.parse(fs.readFileSync(configPath, "utf8")) as AgentConfig;
  if (fs.existsSync(localPath)) {
    const local = JSON.parse(fs.readFileSync(localPath, "utf8")) as Partial<AgentConfig>;
    // tools 按 key 浅合并：local 只覆盖它显式写过的键，
    // 避免 local 的全量快照遮蔽 config.json 后续新增的 tools 条目（如安装脚本写入）
    const baseTools = base.tools;
    Object.assign(base, local);
    if (local.tools && typeof local.tools === "object") {
      base.tools = { ...baseTools, ...local.tools };
    }
  }
  if (!base.agentId) {
    base.agentId = loadOrCreateAgentId(path.join(dir, "..", ".agent-id"));
  }
  if (process.env.RELAY_URL) base.relayUrl = process.env.RELAY_URL;
  return base;
}

export function saveLocalConfig(partial: Partial<AgentConfig>) {
  let current: Partial<AgentConfig> = {};
  if (fs.existsSync(localPath)) {
    current = JSON.parse(fs.readFileSync(localPath, "utf8"));
  }
  Object.assign(current, partial);
  fs.writeFileSync(localPath, JSON.stringify(current, null, 2));
}

function loadOrCreateAgentId(file: string): string {
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const id = crypto.randomUUID();
  fs.writeFileSync(file, id);
  return id;
}

export function resolveWorkspace(cfg: AgentConfig, workspaceId: string): Workspace {
  const ws = cfg.workspaces.find((w) => w.id === workspaceId);
  if (!ws) throw new Error(`未知工作区: ${workspaceId}`);
  const resolved = path.resolve(ws.path);
  if (!fs.existsSync(resolved)) throw new Error(`工作区路径不存在: ${resolved}`);
  return { ...ws, path: resolved };
}

export function assertPathInWorkspace(workspacePath: string, target: string) {
  const ws = path.resolve(workspacePath);
  const t = path.resolve(target);
  if (!t.startsWith(ws)) throw new Error(`路径不在白名单工作区内: ${t}`);
}

export function hostname() {
  return os.hostname();
}

export function getSessionConfig(cfg: AgentConfig): SessionConfig {
  return cfg.session ?? {};
}

const fileOfferDefaults = {
  enabled: true,
  patterns: ["**/*.apk"],
  excludeDirs: [
    "node_modules",
    ".git",
    ".svn",
    ".gradle",
    ".dart_tool",
    ".idea",
    ".cache",
    "Pods",
  ],
  maxFiles: 3,
  maxFileMb: 500,
};

export function getFileOfferConfig(cfg: AgentConfig) {
  return { ...fileOfferDefaults, ...cfg.fileOffer };
}
