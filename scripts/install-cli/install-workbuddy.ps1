#Requires -Version 5.1
<#
.SYNOPSIS
  准备 WorkBuddy 遥控环境：确保 Chrome + Claude，并写入 agent.config.json
.NOTES
  WorkBuddy 本身是网页（https://workbuddy.cn/app），无需安装客户端。
  依赖：Chrome（浏览器自动化）+ Claude CLI（页面规划）。
#>
param(
  [switch]$SkipClaudeInstall,
  [switch]$SkipConfig,
  [string]$WorkbuddyUrl = "https://workbuddy.cn/app",
  [string]$CdpPort = "9333"
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "WorkBuddy 环境（Chrome + Claude）"

function Resolve-ChromePath {
  return Find-FirstExisting @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
  )
}

$chrome = Resolve-ChromePath
if (-not $chrome) {
  Write-Warn "未找到 Chrome/Edge，尝试 winget 安装 Google Chrome…"
  if (Test-Winget) {
    winget install -e --id Google.Chrome --accept-package-agreements --accept-source-agreements
    $chrome = Resolve-ChromePath
  }
  if (-not $chrome) {
    throw "请先安装 Google Chrome，然后重跑本脚本。"
  }
}
Write-Ok "浏览器: $chrome"

# Claude：WorkBuddy 规划依赖它
$claudeScript = Join-Path $PSScriptRoot "install-claude.ps1"
if ($SkipClaudeInstall) {
  Write-Warn "已跳过 Claude 安装（-SkipClaudeInstall）。请确认 tools.claude 可用。"
} else {
  Write-Step "确保 Claude CLI 可用（WorkBuddy 规划用）"
  if ($SkipConfig) {
    & $claudeScript -SkipConfig
  } else {
    & $claudeScript
  }
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "chrome" -Value $chrome
  Update-AgentToolPath -Key "workbuddyUrl" -Value $WorkbuddyUrl
  Update-AgentToolPath -Key "workbuddyCdpPort" -Value $CdpPort
}

$profileDir = Join-Path (Get-RepoRoot) "agent\data\workbuddy-chrome-profile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
Write-Ok "专用 Chrome 配置目录: $profileDir"

Write-Host ""
Write-Host "下一步：" -ForegroundColor White
Write-Host "  1. 重启 Agent：npm run agent"
Write-Host "  2. 手机选 WorkBuddy，发任意短指令（会弹出专用 Chrome）"
Write-Host "  3. 在弹出的 Chrome 里打开并登录 $WorkbuddyUrl（只需一次）"
Write-Host "  4. 登录完成后手机任务会自动继续"
