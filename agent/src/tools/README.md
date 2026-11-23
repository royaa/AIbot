# CLI 注册表（Tool Registry）

增删 App 主入口 CLI，优先只改 [`registry.ts`](./registry.ts)。

## 下架（从菜单隐藏，保留兼容执行）

把对应条目的 `primary: false`。

## 新增主 CLI（例如 `gemini`）

1. **协议** `shared/protocol/src/index.ts`：`ToolKind` 枚举加上 `gemini`
2. **Runner** `agent/src/runners/geminiRunner.ts`：实现 spawn / 输出解析
3. **Registry** `registry.ts`：加一条（`primary` / `supportsModels` / `conversational` / `nativeResume` / `run` / 可选 `discoverModels`）
4. **配置** `agent.config.json` → `tools.gemini` 可执行路径
5. 构建：`npm run build -w shared/protocol && npm run build -w agent`，重启 Agent；协议变更时同步部署 Relay
6. App **无需改菜单**（会从 `agent.status.toolCatalog` 拉取）；若协议大改需重装 App

## 取文件（file）

- 工具 id：`file`（**动作类**，`chatSelectable: false`，不出现在对话 CLI 选择器）
- 用法：协议仍支持手动 task（prompt 为工作区相对路径）；日常以**自动推送**为主
- **自动推送**：任务成功结束后扫描工作区新产物（默认任意层级 `*.apk`），自动上传并推送到手机；配置见 `agent.config.json` → `fileOffer`：

```json
"fileOffer": {
  "enabled": true,
  "patterns": ["**/*.apk"],
  "excludeDirs": ["node_modules", ".git", ".svn", ".gradle", ".dart_tool"],
  "maxFiles": 3,
  "maxFileMb": 500
}
```

- Relay 侧配置（env）：`FILES_DIR`（默认 `relay/data/files`）、`FILES_TTL_HOURS`（默认 24）、`MAX_FILE_MB`（默认 500）；**Relay 需重新部署才有 `/files` HTTP 端点**

## WorkBuddy（浏览器遥控）

- 工具 id：`workbuddy`
- 专用 Chrome 配置目录：`agent/data/workbuddy-chrome-profile`
- CDP 端口：`tools.workbuddyCdpPort`（默认 9333）
- 人工在本机 Chrome 登录一次后，Cookie 常驻；手机用自然语言下指令即可
- 页面规划依赖本机 `tools.claude`

## 字段说明

| 字段 | 含义 |
|------|------|
| `primary` | 是否出现在手机 App CLI 菜单 |
| `supportsModels` | 是否展示模型选择 |
| `conversational` | 是否走多轮会话编排 |
| `nativeResume` | 是否用 CLI 原生 resume |
| `skipOrchestrate` | 个别任务跳过编排（如 DSH desktop） |
| `hostKind` | `cli` = 本机 CLI 自带模型/MCP；`agent` = PC Agent 托管（切对话 CLI 不影响） |
| `capabilityNote` | App 菜单副标题：切换 CLI 时的能力预期 |
| `chatSelectable` | 是否可进对话 CLI 选择器；`false` 为动作类（如取文件） |

## 公共技能

对话型 runner 会注入 [`../skills`](../skills/README.md) 目录下启用的 `SKILL.md`。  
配置见 `agent.config.json` → `skills`。

## 公共 MCP（投影）

见 [`../mcp.catalog.json`](../mcp.catalog.json)。默认 **Agent 启动自动投影**（`mcp.autoSync`），Claude 任务另带 `--mcp-config`（`mcp.injectClaude`）。  
手动：`npm run sync:mcp`。不做 Agent 级 MCP Host。
