# Agent 公共技能

对话型 CLI（Claude / Cursor Agent / Codex / Grok / DSH 等）在执行任务时，会自动注入本目录下启用的技能正文，切换 CLI 也能遵守同一套本机规矩。

## 目录约定

```
skills/
  <skill-id>/
    SKILL.md           # 必填：技能正文（可含 YAML frontmatter name/description）
    skill.config.json  # 可选：enabled、appendTools
```

`skill.config.json` 示例：

```json
{
  "enabled": true,
  "appendTools": {
    "svn": "本机 SVN 可执行文件"
  }
}
```

`appendTools` 会把 `agent.config.json` → `tools.<key>` 的路径追加到该技能末尾。

## 全局开关

`agent.config.json`：

```json
"skills": {
  "enabled": true,
  "include": [],
  "exclude": []
}
```

- `enabled: false`：关闭全部注入
- `include`：非空时只加载列出的 skill-id
- `exclude`：始终跳过的 skill-id

## 与 MCP / Registry 的关系

- **技能**：文本规矩，注入 prompt / system prompt
- **Registry 工具**（取文件、WorkBuddy、SVN 入口）：Agent 托管，与对话 CLI 无关
- **MCP**：各 CLI 本机配置；用 `agent/mcp.catalog.json` + `npm run sync:mcp` 投影，不在 Agent 进程内跑 MCP
