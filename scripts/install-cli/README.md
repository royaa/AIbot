# 本机 CLI 安装脚本（Windows PowerShell）

在仓库根目录执行：

```powershell
# 全部（Claude + Cursor Agent + Codex + OpenCode + Pi + Droid + Crush + WorkBuddy/Chrome）
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-all.ps1

# 单独安装
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-claude.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-cursor-agent.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-codex.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-opencode.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-pi.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-droid.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-crush.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-workbuddy.ps1

# 一键跳过某项
powershell ... install-all.ps1 -SkipWorkbuddy -SkipDroid
```

脚本会：

1. 调用官方安装器（或 winget / npm 回退）
2. 探测本机绝对路径
3. 写回 `agent/agent.config.json` 的 `tools.*`（可用 `-SkipConfig` 跳过）

也可经 **PC 客户端控制通道**远程触发（`cli.install` 请求，Agent 内执行同样脚本并流式回传输出）。

## 安装来源与 API 配置落点

安装方式参照智谱 [GLM Coding Plan 工具文档](https://docs.bigmodel.cn/cn/coding-plan/tool/cursor)：

| CLI | 安装命令 | apiUrl/apiKey 落点（客户端「CLI 配置」可写） |
|-----|----------|-----------------------------------------------|
| Claude | `npm i -g @anthropic-ai/claude-code` | `~/.claude/settings.json` → env（`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`） |
| Cursor Agent | `irm 'https://cursor.com/install?win32=true' \| iex` | 走 Cursor 账号订阅，无 BYOK（见下方专项说明） |
| Codex | `npm i -g @openai/codex` | `~/.codex/config.toml`（`experimental_bearer_token`，wire_api=responses）+ `~/.codex/models.json` |
| OpenCode | `npm i -g opencode-ai` | `~/.config/opencode/opencode.json`（端点）+ `~/.local/share/opencode/auth.json`（密钥） |
| Pi | `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` | 环境变量 `ZAI_CODING_CN_API_KEY`（provider 端点内建） |
| Droid | `irm https://app.factory.ai/cli/windows \| iex` | `~/.factory/settings.json` → `customModels[]`（BYOK） |
| Crush | `npm i -g @charmland/crush` | `~/.config/crush/crush.json` → `providers.zai` |

### Cursor Agent 安装说明（Windows）

1. **安装**（Cursor 官方安装器，PowerShell 执行）：

   ```powershell
   irm 'https://cursor.com/install?win32=true' | iex
   # 或用本仓库脚本（安装 + 探测 + 自动写回 agent.config.json 的 tools.agent）
   powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-cursor-agent.ps1
   ```

2. **落点**：`%LOCALAPPDATA%\cursor-agent\agent.ps1`（本仓库脚本会自动探测并写入 `tools.agent`，同时置 `tools.cursorAgentTrust=true` 免首次确认）
3. **登录**（无法自动化）：新开 PowerShell 执行 `agent login`，按提示在浏览器完成 Cursor 账号授权
4. **验证**：`agent --list-models` 能列出模型即成功；也可在手机端选 Cursor Agent 发一条短指令测试
5. **API 说明**：Cursor Agent 使用 Cursor 账号订阅额度，**不支持自定义 apiUrl/apiKey**；若想让 Cursor IDE（而非 Agent CLI）用 GLM Coding Plan，参照[智谱 Cursor 文档](https://docs.bigmodel.cn/cn/coding-plan/tool/cursor)在 IDE 的 Models → OpenAI 协议里配置 `https://open.bigmodel.cn/api/coding/paas/v4` + API Key（模型名需大写如 `GLM-5.2`，且需 Cursor 高级会员）

## 登录指引（无法自动化的部分）

| CLI | 登录命令 |
|-----|----------|
| Claude | API Key 经客户端写入后免登录；官方登录则运行 `claude` |
| Cursor Agent | `agent login` |
| Codex | API Key 经客户端写入后免登录 |
| OpenCode | API Key 经客户端写入；或 `opencode auth login` 选 Zhipu AI Coding Plan |
| Pi | API Key 经客户端写入；或 pi 内 `/login zai-coding-cn` |
| Droid | 首次运行 `droid` 需浏览器登录 Factory 账户（**海外手机号验证**） |
| Crush | API Key 经客户端写入；启动后 `/models` 选模型 |
| WorkBuddy | 手机发任务弹出的 Chrome 里登录一次 `https://workbuddy.cn/app` |

改配置后重启：`npm run agent`。
