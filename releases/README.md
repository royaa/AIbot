# AI Bot Android 安装包

| 文件 | 版本 | 说明 |
|------|------|------|
| [grokbot_app-1.0.1+22.apk](./grokbot_app-1.0.1+22.apk) | 1.0.1 (build 22) | 文件下发到手机：任务自动推送新 APK，「取文件」工具手动推送；聊天卡片下载（断点续传）+ 打开/安装（需新版 Relay 支持 `/files`） |
| [grokbot_app-1.0.0+13.apk](./grokbot_app-1.0.0+13.apk) | 1.0.0 (build 13) | CLI 精简为 Claude/Cursor Agent/Codex；SVN 改为 AI skill（说提交代码即 svn ci） |
| [grokbot_app-1.0.0+12.apk](./grokbot_app-1.0.0+12.apk) | 1.0.0 (build 12) | 原生 CLI 会话+跨 CLI 记忆交接；App 按 CLI 动态选择模型（Grok/Claude/Cursor Agent） |
| [grokbot_app-1.0.0+11.apk](./grokbot_app-1.0.0+11.apk) | 1.0.0 (build 11) | 图片上传；任务 sessionId + Agent CLI 修复 |
| [grokbot_app-1.0.0+10.apk](./grokbot_app-1.0.0+10.apk) | 1.0.0 (build 10) | 任务携带 sessionId，配合 PC Agent 会话编排（上下文/resume） |
| [grokbot_app-1.0.0+7.apk](./grokbot_app-1.0.0+7.apk) | 1.0.0 (build 7) | 多会话并行、停止任务、JSON 解析、UI 改版、SVN 子目录改弹窗 |
| [grokbot_app-1.0.0+4.apk](./grokbot_app-1.0.0+4.apk) | 1.0.0 (build 4) | Relay/Agent 连接状态栏、任务阶段、超时与离线提示 |
| [grokbot_app-1.0.0+3.apk](./grokbot_app-1.0.0+3.apk) | 1.0.0 (build 3) | 对话式 SVN、SVN 子目录、发送清空输入框 |
| [grokbot_app-1.0.0+2.apk](./grokbot_app-1.0.0+2.apk) | 1.0.0 (build 2) | 上一版 |

## 安装

1. 将 APK 传到手机并安装（需允许「未知来源」）。
2. 打开 App，Relay 默认：`ws://replay.githun.cn/ws`
3. 在本机启动 PC Agent，用控制台配对码完成配对。

## 重新打包（开发机）

```powershell
$env:GRADLE_USER_HOME="$env:USERPROFILE\.gradle"
cd D:\wamp64_332\www\grokbot\app
flutter pub get
flutter build apk --release
copy build\app\outputs\flutter-apk\app-release.apk ..\releases\grokbot_app-1.0.0+4.apk
```

若 Gradle 报锁文件超时，先结束所有 `java` 进程后再构建。
