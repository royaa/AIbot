#Requires -Version 5.1
<#
.SYNOPSIS
  安装 OpenCode CLI（opencode-ai），并把路径写入 agent.config.json 的 tools.opencode
.NOTES
  官方文档：https://docs.bigmodel.cn/cn/coding-plan/tool/opencode
  npm 安装：npm install -g opencode-ai
  密钥配置：客户端「CLI 配置」写入，或本机运行 opencode auth login 选 Zhipu AI Coding Plan
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipConfig
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "OpenCode CLI"

function Resolve-OpenCodePath {
  $fromPath = Find-OnPath "opencode"
  if ($fromPath) { return $fromPath }
  return Find-NpmGlobal "opencode"
}

$existing = Resolve-OpenCodePath
if ($existing -and $SkipInstall) {
  Write-Ok "已找到: $existing"
} elseif ($existing -and -not $SkipInstall) {
  Write-Ok "已安装: $existing（跳过下载；加 -SkipInstall 可仅探测）"
} else {
  Write-Step "npm install -g opencode-ai"
  npm install -g opencode-ai
  if ($LASTEXITCODE -ne 0) {
    throw "npm 安装 opencode 失败（exit=$LASTEXITCODE）。可改用官方脚本: curl -fsSL https://opencode.ai/install | bash（需 bash 环境）"
  }
  $existing = Resolve-OpenCodePath
  if (-not $existing) {
    throw "安装后仍找不到 opencode。请新开 PowerShell 再跑本脚本（-SkipInstall），或 where.exe opencode"
  }
  Write-Ok "安装完成: $existing"
}

try {
  & $existing --version 2>&1 | Out-Host
} catch {
  Write-Warn "无法执行 --version（可能需新开终端）：$_"
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "opencode" -Value $existing
}

Write-Host ""
Write-Host "下一步：" -ForegroundColor White
Write-Host "  客户端「CLI 配置 → OpenCode」填入 API Key；或本机: opencode auth login（选 Zhipu AI Coding Plan）"
Write-Host "  启动: opencode，用 /models 选 GLM 模型"
