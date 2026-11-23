# 公共 MCP 清单（投影，非运行时）

[`mcp.catalog.json`](./mcp.catalog.json) 定义希望在多 CLI 间对齐的 MCP Server。  
**Agent 进程不启动、不代理 MCP**；用脚本把清单合并进各 CLI 本机配置。

## 自动生效（默认）

`agent.config.json`：

```json
"mcp": {
  "autoSync": true,
  "injectClaude": true
}
```

| 开关 | 作用 |
|------|------|
| `autoSync` | **Agent 启动时**自动把清单合并进本机 Claude / Cursor / Codex 配置 |
| `injectClaude` | **每次 Claude 任务**带 `--mcp-config`，当次会话立即挂上 MCP（不必重启 Claude） |

Cursor Agent / Codex 读的是本机配置文件：改清单后重启一次 Agent 即可投影；已打开的 Cursor IDE 可能仍需重载窗口才能看到新 MCP。

## 手动同步（可选）

```bash
npm run sync:mcp
npm run sync:mcp -- --dry-run
npm run sync:mcp -- --targets=cursor
```

| target | 写入位置 |
|--------|----------|
| `cursor` | `~/.cursor/mcp.json` → `mcpServers` |
| `claude` | `~/.claude.json`（若无则 `~/.claude/settings.json`）→ `mcpServers` |
| `codex` | `~/.codex/config.toml` → `[mcp_servers.<id>]` |

变量占位：`${CURSOR_HOME}`、`${NODE_EXE}`、`${MYSQL_HOST:127.0.0.1}` 等（环境变量，缺省用冒号后默认值）。

## 与公共技能的关系

- 技能 [`skills/mysql-mcp`](./skills/mysql-mcp) 告诉对话 CLI「优先用 MySQL MCP」
- 投影脚本负责让 Claude / Cursor / Codex **真的挂上**该 MCP
- 弱工具链 CLI（Grok/DSH）不强制伪造 MCP；技能会提示改换 CLI

## 不要做的事

- 不要在 Agent 内嵌 MCP Host 再动态挂给当前任务
- 不要把真实密码提交进 git；用环境变量或本机已有配置覆盖
