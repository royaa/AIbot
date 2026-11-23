#Requires -Version 5.1
<#
.SYNOPSIS
  安装 Crush CLI（@charmland/crush），并把路径写入 agent.config.json 的 tools.crush
.NOTES
  官方文档：https://docs.bigmodel.cn/cn/coding-plan/tool/crush
  npm 安装：npm install -g @charmland/crush
  密钥配置：客户端「CLI 配置」写入（~/.config/crush/crush.json providers.zai）
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipConfig
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "Crush CLI"

function Resolve-CrushPath {
  $fromPath = Find-OnPath "crush"
  if ($fromPath) { return $fromPath }
  return Find-NpmGlobal "crush"
}

$existing = Resolve-CrushPath
if ($existing -and $SkipInstall) {
  Write-Ok "已找到: $existing"
} elseif ($existing -and -not $SkipInstall) {
  Write-Ok "已安装: $existing（跳过下载；加 -SkipInstall 可仅探测）"
} else {
  Write-Step "npm install -g @charmland/crush"
  npm install -g "@charmland/crush"
  if ($LASTEXITCODE -ne 0) {
    throw "npm 安装 crush 失败（exit=$LASTEXITCODE）"
  }
  $existing = Resolve-CrushPath
  if (-not $existing) {
    throw "安装后仍找不到 crush。请新开 PowerShell 再跑本脚本（-SkipInstall），或 where.exe crush"
  }
  Write-Ok "安装完成: $existing"
}

try {
  & $existing --version 2>&1 | Out-Host
} catch {
  Write-Warn "无法执行 --version（可能需新开终端）：$_"
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "crush" -Value $existing
}

Write-Host ""
Write-Host "下一步：" -ForegroundColor White
Write-Host "  客户端「CLI 配置 → Crush」填入 API Key（写入 ~/.config/crush/crush.json）"
Write-Host "  启动: crush，用 /models 选 GLM 模型"
