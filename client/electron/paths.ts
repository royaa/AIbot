import path from "node:path";
import { app } from "electron";

/**
 * Agent 目录解析：
 * - 开发态：client/dist → client → 仓库根 → agent
 * - 打包态：resources/grokbot/agent（extraResources 随包分发，per-user 安装目录可写）
 */
export const agentDir = app.isPackaged
  ? path.join(process.resourcesPath, "grokbot", "agent")
  : path.resolve(__dirname, "..", "..", "agent");

/** Agent 的本地控制通道发现文件（ctl.json） */
export const ctlFile = path.join(agentDir, "data", "ctl.json");
