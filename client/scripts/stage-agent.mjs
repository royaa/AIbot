#!/usr/bin/env node
/**
 * 打包前暂存 Agent 运行时：client/staging/grokbot/
 *   ├─ agent/（dist、配置、skills、mcp.catalog、.env、.agent-id、local.json —— 保持既有配对身份）
 *   ├─ shared/protocol/（dist + package.json）
 *   ├─ scripts/install-cli/（客户端「一键安装」远程执行的脚本）
 *   ├─ package.json（workspaces）+ node_modules（npm install --omit=dev 物化，无符号链接残留问题）
 * electron-builder 以 extraResources 把整个目录放进安装包 resources/grokbot。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(clientRoot, "..");
const staging = path.join(clientRoot, "staging", "grokbot");

const copyDir = (src, dest, filter) => {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (s, d) => (filter ? filter(s, d) : true),
  });
};

fs.rmSync(path.join(clientRoot, "staging"), { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const noNodeModules = (s) => !s.includes(`${path.sep}node_modules`);

// 1) agent（含身份与配置文件；排除 data/、logs/、src/、*.live-bak）
copyDir(path.join(repoRoot, "agent"), path.join(staging, "agent"), (s) => {
  if (!noNodeModules(s)) return false;
  const rel = path.relative(path.join(repoRoot, "agent"), s);
  if (rel.startsWith("data") || rel.startsWith("logs") || rel.startsWith("src")) return false;
  if (rel.endsWith(".live-bak")) return false;
  return true;
});

// 2) shared/protocol（运行时只需 package.json + dist）
fs.mkdirSync(path.join(staging, "shared", "protocol"), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, "shared", "protocol", "package.json"),
  path.join(staging, "shared", "protocol", "package.json"),
);
copyDir(
  path.join(repoRoot, "shared", "protocol", "dist"),
  path.join(staging, "shared", "protocol", "dist"),
);

// 3) install-cli 脚本
copyDir(
  path.join(repoRoot, "scripts", "install-cli"),
  path.join(staging, "scripts", "install-cli"),
);

// 4) 根 package.json（最小 workspaces 清单）
fs.writeFileSync(
  path.join(staging, "package.json"),
  JSON.stringify(
    {
      name: "grokbot-agent-runtime",
      private: true,
      workspaces: ["shared/protocol", "agent"],
    },
    null,
    2,
  ),
);

// 5) 物化生产依赖（走国内镜像，避免官方源被重置）
console.log("[stage] npm install --omit=dev …");
execSync("npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com", {
  cwd: staging,
  stdio: "inherit",
});

const size = execSync(`powershell -NoProfile -Command "(Get-ChildItem -Recurse '${staging.replace(/'/g, "''")}' | Measure-Object -Property Length -Sum).Sum / 1MB"`)
  .toString()
  .trim();
console.log(`[stage] 完成：${staging}（约 ${Number(size).toFixed(1)} MB）`);
