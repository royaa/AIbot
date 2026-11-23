#!/usr/bin/env node
/**
 * 将 agent/mcp.catalog.json 投影到本机 Claude / Cursor / Codex MCP 配置。
 * 逻辑在 @grokbot/agent 的 dist/mcp/sync.js；本脚本仅作 CLI 入口。
 *
 * 用法：
 *   npm run sync:mcp
 *   npm run sync:mcp -- --dry-run
 *   npm run sync:mcp -- --targets=cursor,claude
 *
 * Agent 默认在启动时也会自动投影（agent.config.json → mcp.autoSync）。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncJs = path.join(root, "agent", "dist", "mcp", "sync.js");

const dryRun = process.argv.includes("--dry-run");
const targetsArg = process.argv
  .find((a) => a.startsWith("--targets="))
  ?.slice("--targets=".length);
const targets = targetsArg
  ? targetsArg.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;

const mod = await import(pathToFileURL(syncJs).href);
const result = mod.syncMcpCatalog({
  dryRun,
  targets,
  log: (s) => console.log(s),
});
if (!result.ok) {
  console.error(`[sync-mcp] ${result.message}`);
  process.exit(1);
}
