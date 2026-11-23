import type { AgentConfig } from "../config.js";
import { loadSkillsText, withSkillsPrompt } from "./loader.js";

/**
 * @deprecated 使用 loadSkillsText；保留别名以兼容旧 import。
 * 现已注入全部启用的公共技能（含 svn-commit）。
 */
export function loadSvnSkillText(cfg: AgentConfig): string {
  return loadSkillsText(cfg);
}

/**
 * @deprecated 使用 withSkillsPrompt。
 */
export function withSvnSkillPrompt(
  cfg: AgentConfig,
  prompt: string,
): string {
  return withSkillsPrompt(cfg, prompt);
}
