import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig, SkillsConfig } from "../config.js";

export type SkillConfigFile = {
  /** 默认 true；设为 false 可禁用单个技能包 */
  enabled?: boolean;
  /**
   * 注入正文末尾时追加的本机工具路径。
   * key = agent.config.json → tools 字段名；value = 小节标题。
   */
  appendTools?: Record<string, string>;
};

export type LoadedSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
  config: SkillConfigFile;
};

const skillsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills",
);

function getSkillsConfig(cfg: AgentConfig): SkillsConfig {
  return {
    enabled: true,
    include: [],
    exclude: [],
    ...cfg.skills,
  };
}

function parseFrontmatter(raw: string): {
  name?: string;
  description?: string;
  body: string;
} {
  if (!raw.startsWith("---")) return { body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  let name: string | undefined;
  let description: string | undefined;
  for (const line of fm.split(/\r?\n/)) {
    const m = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    if (key === "name") name = val;
    if (key === "description") description = val;
  }
  return { name, description, body };
}

function readSkillConfig(dir: string): SkillConfigFile {
  const p = path.join(dir, "skill.config.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SkillConfigFile;
  } catch {
    return {};
  }
}

/** 扫描 agent/skills 下各子目录的 SKILL.md，按配置过滤 */
export function listSkills(cfg: AgentConfig): LoadedSkill[] {
  const sc = getSkillsConfig(cfg);
  if (sc.enabled === false) return [];
  if (!fs.existsSync(skillsRoot)) return [];

  const include = new Set((sc.include ?? []).map((s) => s.trim()).filter(Boolean));
  const exclude = new Set((sc.exclude ?? []).map((s) => s.trim()).filter(Boolean));

  const out: LoadedSkill[] = [];
  for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    if (exclude.has(id)) continue;
    if (include.size > 0 && !include.has(id)) continue;

    const dir = path.join(skillsRoot, id);
    const skillCfg = readSkillConfig(dir);
    if (skillCfg.enabled === false) continue;

    const mdPath = path.join(dir, "SKILL.md");
    if (!fs.existsSync(mdPath)) continue;
    const raw = fs.readFileSync(mdPath, "utf8");
    const { name, description, body } = parseFrontmatter(raw);
    out.push({
      id,
      name: name ?? id,
      description: description ?? "",
      body: body.trim(),
      config: skillCfg,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function appendToolFooters(
  cfg: AgentConfig,
  skill: LoadedSkill,
): string {
  const map = skill.config.appendTools;
  if (!map || Object.keys(map).length === 0) return "";
  const lines: string[] = [];
  for (const [toolKey, title] of Object.entries(map)) {
    const bin = cfg.tools[toolKey];
    if (!bin) continue;
    lines.push(`\n## ${title}\n\`${bin}\``);
  }
  if (lines.length === 0) return "";
  return (
    lines.join("") +
    "\n权限：本环境已默认允许执行外部命令与提交，无需再向用户二次确认。\n"
  );
}

/** 合并全部启用技能正文（给 --append-system-prompt 等） */
export function loadSkillsText(cfg: AgentConfig): string {
  const skills = listSkills(cfg);
  if (skills.length === 0) return "";
  const parts = skills.map((s) => {
    const footer = appendToolFooters(cfg, s);
    return (
      `【AI Bot 内置技能：${s.name}】\n` +
      (s.description ? `> ${s.description}\n\n` : "") +
      s.body +
      footer
    );
  });
  return parts.join("\n\n---\n\n");
}

/**
 * 将公共技能注入到用户 prompt 前，确保 Claude / Cursor Agent / Codex / Grok 等
 * 对话型 CLI 遵守同一套本机规矩。
 */
export function withSkillsPrompt(cfg: AgentConfig, prompt: string): string {
  const skills = loadSkillsText(cfg);
  if (!skills.trim()) return prompt;
  return skills + "\n\n---\n\n【当前用户指令】\n" + prompt;
}

/** App / status 用的技能目录摘要 */
export function buildSkillsCatalog(cfg: AgentConfig): Array<{
  id: string;
  name: string;
  description: string;
}> {
  return listSkills(cfg).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));
}
