---
name: agent-hosted
description: 说明由 PC Agent 托管、与当前对话 CLI 无关的能力（取文件、WorkBuddy 浏览器遥控）。用户要推 APK/文件到手机或遥控浏览器时，应引导其在 App 切换到对应工具，而不是在当前 CLI 里硬做。
---

# Agent 托管能力

下列能力由 **PC Agent 进程**直接执行，不依赖 Claude / Codex / Cursor 是否挂了 MCP：

## 取文件（工具 id: `file`）
- 用途：把工作区内文件推到手机（聊天卡片下载）。
- 用户应在 App CLI 菜单选「取文件」，prompt 填工作区相对路径。
- 对话 CLI 里不要假装已经把文件推到手机；请提示用户切换到「取文件」。

## WorkBuddy（工具 id: `workbuddy`）
- 用途：自然语言遥控本机专用 Chrome（CDP）操作网页。
- 用户应在 App 选 WorkBuddy；不要在当前 CLI 用普通浏览工具冒充。

## SVN 独立入口（工具 id: `svn`）
- App 也可直接选 SVN 工具做 status/update/commit。
- 若用户在对话 CLI 里说「提交代码」，仍按 **svn-commit** 技能用本机 `svn` 命令处理。
