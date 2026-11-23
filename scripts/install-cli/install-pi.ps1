#Requires -Version 5.1
<#
.SYNOPSIS
  安装 Pi Coding Agent（@earendil-works/pi-coding-agent），并把路径写入 agent.config.json 的 tools.pi
.NOTES
  官方文档：https://docs.bigmodel.cn/cn/coding-plan/tool/pi
  npm 安装需 --ignore-scripts（官方说明：正常安装不需要 install scripts）
  密钥配置：客户端「CLI 配置」写入环境变量 ZAI_CODING_CN_API_KEY，或 pi 内 /login zai-coding-cn
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipConfig
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "Pi Coding Agent"

function Resolve-PiPath {
  $fromPath = Find-OnPath "pi"
  if ($fromPath) { return $fromPath }
  return Find-NpmGlobal "pi"
}

$existing = Resolve-PiPath
if ($existing -and $SkipInstall) {
  Write-Ok "已找到: $existing"
} elseif ($existing -and -not $SkipInstall) {
  Write-Ok "已安装: $existing（跳过下载；加 -SkipInstall 可仅探测）"
} else {
  Write-Step "npm install -g --ignore-scripts @earendil-works/pi-coding-agent"
  npm install -g --ignore-scripts "@earendil-works/pi-coding-agent"
  if ($LASTEXITCODE -ne 0) {
    throw "npm 安装 pi 失败（exit=$LASTEXITCODE）"
  }
  $existing = Resolve-PiPath
  if (-not $existing) {
    throw "安装后仍找不到 pi。请新开 PowerShell 再跑本脚本（-SkipInstall），或 where.exe pi"
  }
  Write-Ok "安装完成: $existing"
}

try {
  & $existing --version 2>&1 | Out-Host
} catch {
  Write-Warn "无法执行 --version（可能需新开终端）：$_"
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "pi" -Value $existing
}

Write-Host ""
Write-Host "下一步：" -ForegroundColor White
Write-Host "  客户端「CLI 配置 → Pi」填入 API Key（写入环境变量 ZAI_CODING_CN_API_KEY）"
Write-Host "  或启动 pi 后执行: /login zai-coding-cn，再用 /model 选 GLM 模型"
