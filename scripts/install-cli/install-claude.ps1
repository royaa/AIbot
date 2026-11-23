#Requires -Version 5.1
<#
.SYNOPSIS
  安装 Claude Code CLI，并把绝对路径写入 agent.config.json 的 tools.claude
.NOTES
  官方安装：irm https://claude.ai/install.ps1 | iex
  登录需在本机手动执行：claude
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipConfig
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "Claude Code CLI"

function Resolve-ClaudePath {
  $fromPath = Find-OnPath "claude"
  if ($fromPath) { return $fromPath }
  return Find-FirstExisting @(
    "$env:USERPROFILE\.local\bin\claude.exe",
    "$env:LOCALAPPDATA\Programs\ClaudeCode\claude.exe",
    "$env:LOCALAPPDATA\claude\claude.exe"
  )
}

$existing = Resolve-ClaudePath
if ($existing -and $SkipInstall) {
  Write-Ok "已找到: $existing"
} elseif ($existing -and -not $SkipInstall) {
  Write-Ok "已安装: $existing（跳过下载；加 -SkipInstall 可仅探测）"
} else {
  Write-Step "运行官方安装脚本（claude.ai）"
  try {
    Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  } catch {
    Write-Warn "官方脚本失败，尝试 winget…"
    if (Test-Winget) {
      winget install -e --id Anthropic.ClaudeCode --accept-package-agreements --accept-source-agreements
    } else {
      throw "Claude 安装失败，且本机无 winget。请手动：irm https://claude.ai/install.ps1 | iex"
    }
  }
  $existing = Resolve-ClaudePath
  if (-not $existing) {
    throw "安装后仍找不到 claude.exe。请新开 PowerShell 再跑本脚本，或手动 where.exe claude"
  }
  Write-Ok "安装完成: $existing"
}

try {
  & $existing --version 2>&1 | Out-Host
} catch {
  Write-Warn "无法执行 --version（可能需新开终端）：$_"
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "claude" -Value $existing
}

Write-Host ""
Write-Host "下一步（需人工登录）：" -ForegroundColor White
Write-Host "  claude"
Write-Host "  或: & `"$existing`""
Write-Host "登录成功后再用手机选 Claude / 自动 / WorkBuddy。"
