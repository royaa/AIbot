import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import type { CliConfigSetPayload, CliConfigView } from "@grokbot/protocol";
import type { AgentCore } from "../core.js";
import type { AgentConfig } from "../config.js";

const agentRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const agentEnvFile = path.join(agentRoot, ".env");

/** 旧版 env_key 流程兼容（provider 声明 env_key 时仍同步环境变量） */
const CODEX_ENV_KEY = "GROKBOT_CODEX_API_KEY";

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── Grok ──────────────────────────────────────────────────

function grokUserSettingsPath() {
  return path.join(os.homedir(), ".grok", "user-settings.json");
}

function getGrokConfig(cfg: AgentConfig): CliConfigView {
  let apiKey = "";
  let apiKeySource: "env" | "agentConfig" | "cliFile" | "none" = "none";
  const fromEnv = process.env.GROK_API_KEY?.trim();
  if (fromEnv) {
    apiKey = fromEnv;
    apiKeySource = "env";
  }
  if (!apiKey) {
    const fromCfg = cfg.tools.grokApiKey?.trim();
    if (fromCfg) {
      apiKey = fromCfg;
      apiKeySource = "agentConfig";
    }
  }
  if (!apiKey) {
    const settings = readJson(grokUserSettingsPath());
    const k = (settings.apiKey ?? settings.api_key) as string | undefined;
    if (k?.trim()) {
      apiKey = k.trim();
      apiKeySource = "cliFile";
    }
  }
  return {
    cli: "grok",
    apiKey,
    baseUrl: cfg.tools.grokBaseUrl ?? process.env.GROK_BASE_URL ?? "",
    apiKeySource,
  };
}

async function setGrokConfig(core: AgentCore, values: Extract<CliConfigSetPayload, { cli: "grok" }>) {
  const tools = { ...core.cfg.tools };
  if (values.apiKey !== undefined) tools.grokApiKey = values.apiKey.trim();
  if (values.baseUrl !== undefined) tools.grokBaseUrl = values.baseUrl.trim();
  core.applyConfigPatch({ tools });

  // 同步写 ~/.grok/user-settings.json，让脱离 Agent 直接跑 grok CLI 也能用
  if (values.apiKey !== undefined && values.apiKey.trim()) {
    const file = grokUserSettingsPath();
    const data = readJson(file);
    data.apiKey = values.apiKey.trim();
    writeJson(file, data);
  }
}

// ─── Claude ────────────────────────────────────────────────

function claudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function getClaudeConfig(): CliConfigView {
  const file = claudeSettingsPath();
  const settings = readJson(file);
  const env = (settings.env ?? {}) as Record<string, string>;
  const baseUrlEnv = process.env.ANTHROPIC_BASE_URL?.trim();
  const baseUrl = baseUrlEnv || env.ANTHROPIC_BASE_URL || "";
  return {
    cli: "claude",
    baseUrl,
    authToken: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? "",
    settingsPath: file,
    baseUrlSource: baseUrlEnv ? "env" : env.ANTHROPIC_BASE_URL ? "cliFile" : "none",
  };
}

async function setClaudeConfig(values: Extract<CliConfigSetPayload, { cli: "claude" }>) {
  const file = claudeSettingsPath();
  const settings = readJson(file);
  const env = (settings.env ?? {}) as Record<string, string>;
  if (values.baseUrl !== undefined) {
    if (values.baseUrl.trim()) env.ANTHROPIC_BASE_URL = values.baseUrl.trim();
    else delete env.ANTHROPIC_BASE_URL;
  }
  if (values.authToken !== undefined) {
    if (values.authToken.trim()) env.ANTHROPIC_AUTH_TOKEN = values.authToken.trim();
    else delete env.ANTHROPIC_AUTH_TOKEN;
  }
  settings.env = env;
  writeJson(file, settings);
}

// ─── Codex ─────────────────────────────────────────────────

/** BigModel 官方文档默认 Provider（wire_api=responses + experimental_bearer_token） */
const CODEX_PROVIDER_DEFAULT = "ZAI";
const CODEX_BASE_URL_DEFAULT = "https://open.bigmodel.cn/api/v1";

function codexConfigPath() {
  return path.join(os.homedir(), ".codex", "config.toml");
}

function codexModelsPath() {
  return path.join(os.homedir(), ".codex", "models.json");
}

/** ~/.codex/models.json 缺失时写入 GLM 模型目录（官方文档模板） */
function ensureCodexModelsJson() {
  const file = codexModelsPath();
  if (fs.existsSync(file)) return;
  const models = {
    models: [
      {
        slug: "glm-5.3",
        display_name: "glm-5.3",
        description: "Z.ai's latest flagship model",
        default_reasoning_level: "max",
        supported_reasoning_levels: [
          { effort: "low", description: "Light reasoning" },
          { effort: "high", description: "Enhanced reasoning" },
          { effort: "max", description: "Deep reasoning" },
        ],
        shell_type: "shell_command",
        visibility: "list",
        supported_in_api: true,
        priority: 0,
        base_instructions: "",
        supports_reasoning_summaries: true,
        default_reasoning_summary: "none",
        support_verbosity: false,
        apply_patch_tool_type: "freeform",
        truncation_policy: { mode: "bytes", limit: 10000 },
        context_window: 1048576,
        max_context_window: 1048576,
        effective_context_window_percent: 95,
        supports_parallel_tool_calls: true,
        experimental_supported_tools: [],
        input_modalities: ["text"],
      },
      {
        slug: "glm-5-turbo",
        display_name: "glm-5-turbo",
        description: "Agent-optimized model",
        default_reasoning_level: "max",
        supported_reasoning_levels: [],
        shell_type: "shell_command",
        visibility: "list",
        supported_in_api: true,
        priority: 1,
        base_instructions: "",
        supports_reasoning_summaries: true,
        default_reasoning_summary: "none",
        support_verbosity: false,
        apply_patch_tool_type: "freeform",
        truncation_policy: { mode: "bytes", limit: 10000 },
        context_window: 204800,
        max_context_window: 204800,
        effective_context_window_percent: 95,
        supports_parallel_tool_calls: true,
        experimental_supported_tools: [],
        input_modalities: ["text"],
      },
    ],
  };
  writeJson(file, models);
}

/** 读取 agent/.env 里的指定变量（不覆盖 process.env，仅展示用） */
function readAgentEnv(key: string): string | undefined {
  try {
    const text = fs.readFileSync(agentEnvFile, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 文件不存在 */
  }
  return undefined;
}

function writeAgentEnv(key: string, value: string) {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(agentEnvFile, "utf8").split(/\r?\n/);
  } catch {
    lines = [];
  }
  const found = lines.findIndex((l) =>
    l.match(new RegExp(`^\\s*${key}\\s*=`)),
  );
  const newLine = value ? `${key}=${value}` : `# ${key}=`;
  if (found >= 0) lines[found] = newLine;
  else {
    // 去掉尾部空行后追加
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(newLine, "");
  }
  fs.writeFileSync(agentEnvFile, lines.join("\n"));
}

function getCodexConfig(): CliConfigView {
  const file = codexConfigPath();
  let providerId: string | undefined;
  let baseUrl = "";
  let apiKey = "";
  try {
    const doc = parseToml(fs.readFileSync(file, "utf8"));
    providerId =
      typeof doc.model_provider === "string" ? doc.model_provider : undefined;
    const provider =
      providerId &&
      doc.model_providers &&
      typeof doc.model_providers === "object"
        ? (doc.model_providers as Record<
            string,
            { base_url?: string; env_key?: string; experimental_bearer_token?: string }
          >)[providerId]
        : undefined;
    baseUrl = provider?.base_url ?? "";
    // 优先官方文档的 experimental_bearer_token；兼容旧 env_key 流程
    apiKey =
      provider?.experimental_bearer_token ??
      process.env[provider?.env_key ?? CODEX_ENV_KEY] ??
      readAgentEnv(provider?.env_key ?? CODEX_ENV_KEY) ??
      "";
  } catch {
    /* config.toml 不存在或解析失败 → 视为未配置 */
  }
  return { cli: "codex", baseUrl, apiKey, configPath: file, providerId };
}

async function setCodexConfig(values: Extract<CliConfigSetPayload, { cli: "codex" }>) {
  const file = codexConfigPath();
  let doc: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      doc = parseToml(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (e) {
      // 文件存在但解析失败（如历史重复块）→ 绝不用空 doc 落盘覆盖，避免洗掉全部配置
      throw new Error(
        `config.toml 解析失败（${e instanceof Error ? e.message : String(e)}），请先修复或删除该文件`,
      );
    }
  }
  const providerId =
    (typeof doc.model_provider === "string" && doc.model_provider) ||
    CODEX_PROVIDER_DEFAULT;
  const providers = { ...(doc.model_providers as object | undefined) } as Record<
    string,
    Record<string, unknown>
  >;
  const existing = providers[providerId] ?? {};
  const provider: Record<string, unknown> = {
    ...existing,
    name: (existing.name as string) ?? providerId,
    wire_api: (existing.wire_api as string) ?? "responses",
  };
  if (values.baseUrl !== undefined && values.baseUrl.trim()) {
    provider.base_url = values.baseUrl.trim();
  } else if (!provider.base_url) {
    provider.base_url = CODEX_BASE_URL_DEFAULT;
  }
  if (values.apiKey !== undefined) {
    const key = values.apiKey.trim();
    // 官方文档方式：key 直接写入 config.toml（experimental_bearer_token）
    if (key) provider.experimental_bearer_token = key;
    else delete provider.experimental_bearer_token;
    // 兼容旧 env_key 流程：若 provider 声明了 env_key，同步进程 env + agent/.env
    const envKey = provider.env_key as string | undefined;
    if (envKey) {
      if (key) process.env[envKey] = key;
      else delete process.env[envKey];
      writeAgentEnv(envKey, key);
    }
  }
  providers[providerId] = provider;
  doc.model_provider = providerId;
  doc.model_providers = providers;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifyToml(doc as never));
  ensureCodexModelsJson();
}

// ─── OpenCode ──────────────────────────────────────────────

const OPENCODE_PROVIDER_ID = "zhipuai";
const OPENCODE_BASE_URL_DEFAULT = "https://open.bigmodel.cn/api/coding/paas/v4";

function opencodeConfigFile() {
  return path.join(os.homedir(), ".config", "opencode", "opencode.json");
}
function opencodeAuthFile() {
  return path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
}

function getOpencodeConfig(): CliConfigView {
  const configFile = opencodeConfigFile();
  const authFile = opencodeAuthFile();
  const cfgDoc = readJson(configFile);
  const provider =
    (cfgDoc.provider as Record<string, { api?: string }> | undefined)?.[
      OPENCODE_PROVIDER_ID
    ] ?? {};
  const authDoc = readJson(authFile);
  const cred = (authDoc[OPENCODE_PROVIDER_ID] as { key?: string } | undefined) ?? {};
  return {
    cli: "opencode",
    baseUrl: provider.api ?? "",
    apiKey: cred.key ?? "",
    configFile,
    authFile,
    providerId: OPENCODE_PROVIDER_ID,
  };
}

async function setOpencodeConfig(values: Extract<CliConfigSetPayload, { cli: "opencode" }>) {
  // 1) 端点覆盖：opencode.json → provider.zhipuai.api
  const configFile = opencodeConfigFile();
  const cfgDoc = readJson(configFile);
  const provider = { ...((cfgDoc.provider as object | undefined) ?? {}) } as Record<
    string,
    Record<string, unknown>
  >;
  const entry = { ...(provider[OPENCODE_PROVIDER_ID] ?? {}) };
  if (values.baseUrl !== undefined) {
    if (values.baseUrl.trim()) entry.api = values.baseUrl.trim();
    else delete entry.api;
  } else if (!entry.api) {
    entry.api = OPENCODE_BASE_URL_DEFAULT;
  }
  provider[OPENCODE_PROVIDER_ID] = entry;
  cfgDoc.provider = provider;
  writeJson(configFile, cfgDoc);

  // 2) 密钥：auth.json → { zhipuai: { type: "api", key } }
  if (values.apiKey !== undefined) {
    const authFile = opencodeAuthFile();
    const authDoc = readJson(authFile);
    if (values.apiKey.trim()) {
      authDoc[OPENCODE_PROVIDER_ID] = { type: "api", key: values.apiKey.trim() };
    } else {
      delete authDoc[OPENCODE_PROVIDER_ID];
    }
    writeJson(authFile, authDoc);
  }
}

// ─── Pi Coding Agent ───────────────────────────────────────

/** 官方文档环境变量方式；/login zai-coding-cn 的凭证存 ~/.pi/agent/auth.json */
const PI_ENV_KEY = "ZAI_CODING_CN_API_KEY";

function piAuthFile() {
  return path.join(os.homedir(), ".pi", "agent", "auth.json");
}

function getPiConfig(): CliConfigView {
  let apiKey = process.env[PI_ENV_KEY]?.trim() ?? "";
  if (!apiKey) apiKey = readAgentEnv(PI_ENV_KEY) ?? "";
  if (!apiKey) {
    // best-effort：解析 /login 保存的凭证（schema 未见公开文档，字段名做两种尝试）
    const doc = readJson(piAuthFile());
    const cred = doc["zai-coding-cn"] as Record<string, unknown> | undefined;
    const k = (cred?.apiKey ?? cred?.key) as string | undefined;
    if (k?.trim()) apiKey = k.trim();
  }
  return {
    cli: "pi",
    apiKey,
    envKey: PI_ENV_KEY,
    loginCommand: "/login zai-coding-cn",
  };
}

async function setPiConfig(values: Extract<CliConfigSetPayload, { cli: "pi" }>) {
  if (values.apiKey === undefined) throw new Error("pi 仅支持设置 apiKey");
  const key = values.apiKey.trim();
  if (key) process.env[PI_ENV_KEY] = key;
  else delete process.env[PI_ENV_KEY];
  writeAgentEnv(PI_ENV_KEY, key);
}

// ─── Droid (Factory) ───────────────────────────────────────

const DROID_BASE_URL_DEFAULT = "https://open.bigmodel.cn/api/anthropic";
const DROID_MODEL_DEFAULT = "glm-5.3";
const DROID_DISPLAY_NAME = "GLM [GLM Coding Plan]";

function droidConfigFile() {
  return path.join(os.homedir(), ".factory", "settings.json");
}

function getDroidConfig(): CliConfigView {
  const configFile = droidConfigFile();
  const doc = readJson(configFile);
  const models = (doc.customModels as Array<Record<string, unknown>> | undefined) ?? [];
  const entry = models.find((m) => String(m.displayName ?? "").includes("GLM"));
  return {
    cli: "droid",
    baseUrl: (entry?.baseUrl as string) ?? "",
    apiKey: (entry?.apiKey as string) ?? "",
    model: (entry?.model as string) ?? "",
    configFile,
    provider: (entry?.provider as string) ?? "anthropic",
  };
}

async function setDroidConfig(values: Extract<CliConfigSetPayload, { cli: "droid" }>) {
  const configFile = droidConfigFile();
  const doc = readJson(configFile);
  const models = ((doc.customModels as Array<Record<string, unknown>>) ?? []).slice();
  const idx = models.findIndex((m) => String(m.displayName ?? "").includes("GLM"));
  const existing = idx >= 0 ? models[idx] : {};
  const entry: Record<string, unknown> = {
    ...existing,
    displayName: (existing.displayName as string) ?? DROID_DISPLAY_NAME,
    model: values.model?.trim() || ((existing.model as string) ?? DROID_MODEL_DEFAULT),
    baseUrl:
      (values.baseUrl?.trim() || (existing.baseUrl as string)) ?? DROID_BASE_URL_DEFAULT,
    provider: (existing.provider as string) ?? "anthropic",
    maxOutputTokens: (existing.maxOutputTokens as number) ?? 131072,
  };
  if (values.apiKey !== undefined) {
    if (values.apiKey.trim()) entry.apiKey = values.apiKey.trim();
    else delete entry.apiKey;
  }
  if (idx >= 0) models[idx] = entry;
  else models.push(entry);
  doc.customModels = models;
  writeJson(configFile, doc);
}

// ─── Crush ─────────────────────────────────────────────────

const CRUSH_PROVIDER_ID = "zai";
const CRUSH_BASE_URL_DEFAULT = "https://open.bigmodel.cn/api/coding/paas/v4";

function crushConfigFile() {
  return path.join(os.homedir(), ".config", "crush", "crush.json");
}

function getCrushConfig(): CliConfigView {
  const configFile = crushConfigFile();
  const doc = readJson(configFile);
  const provider =
    (doc.providers as Record<string, { base_url?: string; api_key?: string }> | undefined)?.[
      CRUSH_PROVIDER_ID
    ] ?? {};
  return {
    cli: "crush",
    baseUrl: provider.base_url ?? "",
    apiKey: provider.api_key ?? "",
    configFile,
    providerId: CRUSH_PROVIDER_ID,
  };
}

async function setCrushConfig(values: Extract<CliConfigSetPayload, { cli: "crush" }>) {
  const configFile = crushConfigFile();
  const doc = readJson(configFile);
  const providers = { ...((doc.providers as object | undefined) ?? {}) } as Record<
    string,
    Record<string, unknown>
  >;
  const entry = { ...(providers[CRUSH_PROVIDER_ID] ?? {}) };
  entry.id = CRUSH_PROVIDER_ID;
  entry.name = (entry.name as string) ?? "ZAI Provider";
  if (values.baseUrl !== undefined) {
    if (values.baseUrl.trim()) entry.base_url = values.baseUrl.trim();
    else delete entry.base_url;
  } else if (!entry.base_url) {
    entry.base_url = CRUSH_BASE_URL_DEFAULT;
  }
  if (values.apiKey !== undefined) {
    if (values.apiKey.trim()) entry.api_key = values.apiKey.trim();
    else delete entry.api_key;
  }
  providers[CRUSH_PROVIDER_ID] = entry;
  doc.providers = providers;
  writeJson(configFile, doc);
}

// ─── 入口 ──────────────────────────────────────────────────

export function getCliConfig(cfg: AgentConfig, cli: string): CliConfigView {
  switch (cli) {
    case "grok":
      return getGrokConfig(cfg);
    case "claude":
      return getClaudeConfig();
    case "codex":
      return getCodexConfig();
    case "opencode":
      return getOpencodeConfig();
    case "pi":
      return getPiConfig();
    case "droid":
      return getDroidConfig();
    case "crush":
      return getCrushConfig();
    default:
      throw new Error(`不支持的 CLI: ${cli}`);
  }
}

export async function setCliConfig(core: AgentCore, payload: CliConfigSetPayload) {
  switch (payload.cli) {
    case "grok":
      await setGrokConfig(core, payload);
      break;
    case "claude":
      await setClaudeConfig(payload);
      break;
    case "codex":
      await setCodexConfig(payload);
      break;
    case "opencode":
      await setOpencodeConfig(payload);
      break;
    case "pi":
      await setPiConfig(payload);
      break;
    case "droid":
      await setDroidConfig(payload);
      break;
    case "crush":
      await setCrushConfig(payload);
      break;
    default:
      throw new Error(`不支持的 CLI: ${String((payload as { cli?: string })?.cli)}`);
  }
}
