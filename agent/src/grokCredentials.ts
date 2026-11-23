import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "./config.js";

export function resolveGrokApiKey(cfg: AgentConfig): string | undefined {
  const fromEnv = process.env.GROK_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const fromCfg = cfg.tools.grokApiKey?.trim();
  if (fromCfg) return fromCfg;
  const settingsPath = path.join(os.homedir(), ".grok", "user-settings.json");
  if (!fs.existsSync(settingsPath)) return undefined;
  try {
    const j = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const key = j.apiKey ?? j.api_key;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    /* ignore */
  }
  return undefined;
}
