#Requires -Version 5.1
<#
.SYNOPSIS
  一键安装/探测本仓库常用 CLI，并写回 agent.config.json
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-all.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-cli\install-all.ps1 -SkipCodex
#>
param(
  [switch]$SkipClaude,
  [switch]$SkipCursorAgent,
  [switch]$SkipCodex,
  [switch]$SkipWorkbuddy,
  [switch]$SkipOpencode,
  [switch]$SkipPi,
  [switch]$SkipDroid,
  [switch]$SkipCrush,
  [switch]$SkipConfig
)

. "$PSScriptRoot\_lib.ps1"

Write-Host "AI Bot — 本机 CLI 安装" -ForegroundColor White
Write-Host "仓库: $(Get-RepoRoot)"
Write-Host "配置: $(Get-AgentConfigPath)"

$failed = @()

function Invoke-One([string]$name, [string]$script, [switch]$skip) {
  if ($skip) {
    Write-Warn "跳过 $name"
    return
  }
  try {
    Write-Step "开始: $name"
    if ($SkipConfig) {
      & $script -SkipConfig
    } else {
      & $script
    }
  } catch {
    Write-Warn "$name 失败: $_"
    $script:failed += $name
  }
}

Invoke-One "Claude Code" (Join-Path $PSScriptRoot "install-claude.ps1") -skip:$SkipClaude
Invoke-One "Cursor Agent" (Join-Path $PSScriptRoot "install-cursor-agent.ps1") -skip:$SkipCursorAgent
Invoke-One "Codex" (Join-Path $PSScriptRoot "install-codex.ps1") -skip:$SkipCodex
Invoke-One "OpenCode" (Join-Path $PSScriptRoot "install-opencode.ps1") -skip:$SkipOpencode
Invoke-One "Pi Coding Agent" (Join-Path $PSScriptRoot "install-pi.ps1") -skip:$SkipPi
Invoke-One "Droid" (Join-Path $PSScriptRoot "install-droid.ps1") -skip:$SkipDroid
Invoke-One "Crush" (Join-Path $PSScriptRoot "install-crush.ps1") -skip:$SkipCrush

if (-not $SkipWorkbuddy) {
  try {
    Write-Step "开始: WorkBuddy 环境"
    $wb = Join-Path $PSScriptRoot "install-workbuddy.ps1"
    # 上面已跑过 Claude 安装则不再重复；若 -SkipClaude 则让 WorkBuddy 自己补装
    $wbArgs = @{}
    if (-not $SkipClaude) { $wbArgs["SkipClaudeInstall"] = $true }
    if ($SkipConfig) { $wbArgs["SkipConfig"] = $true }
    & $wb @wbArgs
  } catch {
    Write-Warn "WorkBuddy 失败: $_"
    $failed += "WorkBuddy"
  }
}

Write-Host ""
Write-Step "汇总"
if ($failed.Count -eq 0) {
  Write-Ok "全部完成（登录仍需你在本机对各 CLI 执行一次）"
} else {
  Write-Warn ("部分失败: " + ($failed -join ", "))
}

Write-Host ""
Write-Host "建议接下来：" -ForegroundColor White
Write-Host "  1. 新开 PowerShell，确认: claude --version / agent --help / codex --version"
Write-Host "  2. 分别登录: claude  |  agent login  |  codex"
Write-Host "  3. 重启 Agent:  npm run agent"
Write-Host "  4. 手机 App 选择对应工具试一条短指令"
