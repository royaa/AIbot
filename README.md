# AI Bot

用手机遥控这台 Windows 电脑上的 AI 命令行。手机和电脑之间经过 Relay 通信，真正执行任务的是本机 Agent。

```text
手机 App ──ws──► Relay ◄──ws── PC Agent ──► Claude / Codex / Cursor Agent / Grok / WorkBuddy …
                      ▲
                      └── PC 控制台（Electron）管理 Agent、配对、CLI 与工作空间
```

大文件不走 WebSocket。Agent 把产物上传到 Relay，手机在聊天卡片里下载（支持断点续传和 sha256 校验）。APK 可以拉起系统安装器，仍需手动确认。

```text
PC Agent ──HTTP POST /files/upload──► Relay
Relay    ──ws file.offer────────────► 手机
手机     ──HTTP GET /files/:id──────► 下载
```

## 组件

| 目录 | 作用 |
|------|------|
| `client` | Windows 控制台。启动 Agent、配对手机、安装 CLI、写 API 配置、管理工作空间 |
| `agent` | 本机 Agent。接收任务并调用 CLI，限制在工作空间白名单内 |
| `app` | Flutter 手机端 |
| `relay` | 中转服务。配对、连接和文件暂存 |
| `shared/protocol` | 手机、Agent、Relay 共用的消息协议 |
| `scripts/install-cli` | 本机 CLI 安装脚本 |
| `docs` | 安装部署与启停排错 |

## 环境

- Node.js 20+、npm
- Windows 10/11（Agent 和各 CLI）
- 可选：Flutter 3.x，用来自己打包手机 App

## 第一次跑起来

```powershell
cd D:\你的路径\aibot
npm install
npm run build
copy agent\agent.config.example.json agent\agent.config.json
copy agent\.env.example agent\.env
```

然后按这个顺序做：

1. 确认 Relay。生产环境一般用已经部署好的地址；本机联调见下文。
2. 打开 PC 控制台，或直接启动 Agent。
3. 在控制台里安装要用的 CLI，并填写 API 地址和密钥。
4. 添加工作空间（手机只能操作这些目录）。
5. 用手机扫配对码。

```powershell
# PC 控制台（需先构建渲染进程和主进程）
npm run client:build
npm run client

# 或者不打开控制台，直接跑 Agent
npm run agent
```

控制台第一次打开会给出分步引导。之后可在「帮助」里重放。安装包：

```powershell
npm run client:build
npm run package -w client
```

产物在 `client/release/AI-Bot-Console-Setup-0.1.0.exe`。安装包不进入 Git。

改代码后按改动范围重建，不必每次全量：

```powershell
npm run build -w agent
npm run build -w shared/protocol
npm run build -w relay
npm run client:build
```

`npm run dev:agent` 可热重载 Agent。

## 配置

本机配置不要提交。复制示例后再改：

| 文件 | 内容 |
|------|------|
| `agent/agent.config.json` | Relay 地址、工作空间、CLI 路径。示例是 `agent/agent.config.example.json` |
| `agent/agent.config.local.json` | 配对 token。由配对过程生成 |
| `agent/.env` | `RELAY_URL`、可选的 `GROK_API_KEY`。示例是 `agent/.env.example` |

工作空间每一行是一个允许手机操作的目录：`id` 用于识别，`name` 显示在手机上，`path` 必须是本机绝对路径。通过控制台保存后立即生效，不用重启 Agent。

各 CLI 的 API Key 优先在控制台「CLI 配置」里填写，会写到对应工具自己的配置文件。`GROK_API_KEY` 只在不走那一页、而要给 Grok 单独配环境变量时才放到 `agent/.env`。

## 安装 CLI

```powershell
npm run install:cli
npm run install:cli:claude
npm run install:cli:cursor
npm run install:cli:codex
npm run install:cli:workbuddy
```

Claude、Cursor Agent 需要各自登录（`claude`、`agent login`）。多数其他 CLI 在控制台写入智谱 GLM Coding Plan 的 Key 即可。WorkBuddy 在第一次任务弹出的 Chrome 里登录一次。细节见 [scripts/install-cli/README.md](scripts/install-cli/README.md)。

公共技能见 [agent/skills/README.md](agent/skills/README.md)。公共 MCP 默认在 Agent 启动时投影到本机 CLI，也可执行 `npm run sync:mcp`。见 [agent/mcp.catalog.README.md](agent/mcp.catalog.README.md)。

## 手机 App

`releases/*.apk` 不进入 Git。在开发机打包：

```powershell
cd app
flutter pub get
flutter build apk --release
adb install -r build\app\outputs\flutter-apk\app-release.apk
```

打开 App 后扫控制台或 Agent 控制台里的配对码。重新配对：`npm run agent:pair`。

没有手机时可以用 `node scripts/mobile-test-client.mjs <配对码>` 测链路。

## 本机联调 Relay

```powershell
copy relay\.env.example relay\.env
npm run dev:relay

# 另一个终端
$env:RELAY_URL='ws://127.0.0.1:8787/ws'
npm run dev:agent
```

健康检查：`http://127.0.0.1:8787/health`。Android 模拟器访问本机用 `ws://10.0.2.2:8787/ws`。

远程部署、域名和安全组见 [docs/安装部署指南.md](docs/安装部署指南.md) 与 [relay/deploy/DNS.md](relay/deploy/DNS.md)。上传部署前设置 `GROKBOT_SSH_PASS`，不要把密码写进仓库。

## 安全

- Agent 只允许访问 `workspaces` 里的目录。
- `autoApprove: false` 时，危险操作要在手机上确认。
- `.env`、`agent.config.json`、配对 token、SSH 密码和 API Key 都不要提交。

## 文档

| 文档 | 内容 |
|------|------|
| [docs/安装部署指南.md](docs/安装部署指南.md) | 本地流程、远程 Relay、CLI、常见问题 |
| [docs/服务启动指南.md](docs/服务启动指南.md) | 日常启停和排错 |
| [agent/src/tools/README.md](agent/src/tools/README.md) | 增加或去掉一个 CLI |
| [releases/README.md](releases/README.md) | 手机包版本记录（二进制不在 Git 里） |
