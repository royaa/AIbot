import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolModelOption } from "@grokbot/protocol";
import type { AgentConfig } from "./config.js";
import { spawnTool } from "./runners/spawnUtil.js";

function cleanText(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function discoverGrokModels(cfg: AgentConfig): Promise<ToolModelOption[]> {
  let settingsModels: string[] = [];
  let settingsApiKey = "";
  let settingsBaseUrl = "";

  const settingsFile = path.join(os.homedir(), ".grok", "user-settings.json");
  if (fs.existsSync(settingsFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as {
        apiKey?: string;
        baseURL?: string;
        models?: unknown;
      };
      if (typeof j.apiKey === "string") settingsApiKey = j.apiKey.trim();
      if (typeof j.baseURL === "string") settingsBaseUrl = j.baseURL.trim();
      if (Array.isArray(j.models)) {
        settingsModels = j.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
      }
    } catch {
      /* ignore */
    }
  }

  const apiKey = (
    cfg.tools.grokApiKey ??
    process.env.GROK_API_KEY ??
    settingsApiKey
  ).trim();
  const baseUrl = (
    cfg.tools.grokBaseUrl ??
    process.env.GROK_BASE_URL ??
    settingsBaseUrl ??
    "https://api.x.ai/v1"
  )
    .trim()
    .replace(/\/+$/, "");

  if (apiKey && baseUrl) {
    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (resp.ok) {
        const body = (await resp.json()) as { data?: Array<{ id?: string }> };
        if (Array.isArray(body.data) && body.data.length > 0) {
          const seen = new Set<string>();
          const out: ToolModelOption[] = [];
          for (const item of body.data) {
            const id = item?.id?.trim();
            if (id && !seen.has(id)) {
              seen.add(id);
              out.push({ id, label: id });
            }
          }
          if (out.length > 0) return out;
        }
      }
    } catch {
      /* 回退到 user-settings.json */
    }
  }

  const seen = new Set<string>();
  const fallback: ToolModelOption[] = [];
  for (const id of settingsModels) {
    const trimmed = id.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      fallback.push({ id: trimmed, label: trimmed });
    }
  }
  return fallback;
}

export function discoverClaudeModels(cfg: AgentConfig): ToolModelOption[] {
  let envMap: Record<string, string> = {};
  let configuredModel = "";

  const settingsFile = path.join(os.homedir(), ".claude", "settings.json");
  if (fs.existsSync(settingsFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as {
        model?: unknown;
        env?: Record<string, unknown>;
      };
      if (typeof j.model === "string") configuredModel = j.model.trim();
      if (j.env && typeof j.env === "object") {
        for (const [k, v] of Object.entries(j.env)) {
          if (typeof v === "string") envMap[k] = v.trim();
        }
      }
    } catch {
      /* ignore */
    }
  }

  const sonnet =
    envMap.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() ||
    "";
  const opus =
    envMap.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() ||
    "";
  const haiku =
    envMap.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim() ||
    "";
  const anthropicModel =
    configuredModel ||
    envMap.ANTHROPIC_MODEL ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    "";

  const out: ToolModelOption[] = [
    { id: "sonnet", label: sonnet ? `sonnet (${sonnet})` : "Claude Sonnet" },
    { id: "opus", label: opus ? `opus (${opus})` : "Claude Opus" },
    { id: "haiku", label: haiku ? `haiku (${haiku})` : "Claude Haiku" },
  ];

  const seen = new Set(out.map((o) => o.id));
  const extras = [
    anthropicModel,
    sonnet,
    opus,
    haiku,
    ...(cfg.tools.claudeModels?.split(",") ?? []),
  ];
  for (const raw of extras) {
    const m = raw?.trim();
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push({ id: m, label: m });
    }
  }

  return out;
}

export async function discoverCursorAgentModels(cfg: AgentConfig): Promise<ToolModelOption[]> {
  const agentCli = cfg.tools.agent ?? "agent";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  let stdout = "";

  try {
    const { done } = spawnTool(
      agentCli,
      ["--list-models"],
      process.cwd(),
      (kind, text) => {
        if (kind === "stdout") stdout += text;
      },
      ac.signal,
    );
    const { exitCode } = await done;
    if (exitCode !== 0 && !stdout.trim()) return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  const seen = new Set<string>();
  const out: ToolModelOption[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = cleanText(rawLine);
    if (!line || line.startsWith("Available models") || line.startsWith("Tip:")) {
      continue;
    }
    const m = /^([A-Za-z0-9._\-\[\]=,]+)\s+-\s+(.+)$/.exec(line);
    if (!m) continue;
    const id = m[1].trim();
    const label = m[2].trim();
    if (!id || id === "auto" || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: `${label} (${id})` });
  }
  return out;
}

export function discoverCodexModels(): ToolModelOption[] {
  const modelsFile = path.join(os.homedir(), ".codex", "models.json");
  const out: ToolModelOption[] = [];
  const seen = new Set<string>();
  if (fs.existsSync(modelsFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(modelsFile, "utf8")) as {
        models?: Array<{ slug?: string; display_name?: string }>;
      };
      for (const m of j.models ?? []) {
        const id = m.slug?.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          label: m.display_name ? `${m.display_name} (${id})` : id,
        });
      }
    } catch {
      /* ignore */
    }
  }
  const cfgFile = path.join(os.homedir(), ".codex", "config.toml");
  if (fs.existsSync(cfgFile)) {
    try {
      const text = fs.readFileSync(cfgFile, "utf8");
      const m = /^model\s*=\s*"([^"]+)"/m.exec(text);
      if (m?.[1] && !seen.has(m[1])) {
        out.unshift({ id: m[1], label: `${m[1]} (当前默认)` });
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** @deprecated 使用 tools/registry.discoverAllRegisteredToolModels */
export async function discoverAllToolModels(
  cfg: AgentConfig,
): Promise<Record<string, ToolModelOption[]>> {
  const { discoverAllRegisteredToolModels } = await import("./tools/registry.js");
  return discoverAllRegisteredToolModels(cfg);
}
