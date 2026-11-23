#Requires -Version 5.1
<#
.SYNOPSIS
  安装 Cursor Agent CLI，并写入 agent.config.json 的 tools.agent
.NOTES
  官方：irm 'https://cursor.com/install?win32=true' | iex
  登录：agent login
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipConfig
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "Cursor Agent CLI"

function Resolve-CursorAgentPath {
  $fromPath = Find-OnPath "agent"
  # PATH 上的 agent 可能是别的软件，优先认 cursor-agent 目录
  $local = Find-FirstExisting @(
    "$env:LOCALAPPDATA\cursor-agent\agent.ps1",
    "$env:LOCALAPPDATA\cursor-agent\agent.cmd",
    "$env:LOCALAPPDATA\cursor-agent\agent.exe"
  )
  if ($local) { return $local }
  if ($fromPath -and ($fromPath -match 'cursor-agent')) { return $fromPath }
  return $null
}

$existing = Resolve-CursorAgentPath
if ($existing -and -not $SkipInstall) {
  Write-Ok "已安装: $existing"
} elseif (-not $existing) {
  if ($SkipInstall) { throw "未找到 Cursor Agent，且指定了 -SkipInstall" }
  Write-Step "运行官方安装脚本（cursor.com）"
  Invoke-RestMethod 'https://cursor.com/install?win32=true' | Invoke-Expression
  $existing = Resolve-CursorAgentPath
  if (-not $existing) {
    throw "安装后仍找不到 agent.ps1。常见路径：%LOCALAPPDATA%\cursor-agent\agent.ps1"
  }
  Write-Ok "安装完成: $existing"
}

Write-Host "  探测模型列表（可选）…"
try {
  if ($existing -like "*.ps1") {
    powershell -NoProfile -ExecutionPolicy Bypass -File $existing --list-models 2>&1 | Select-Object -First 20 | Out-Host
  } else {
    & $existing --list-models 2>&1 | Select-Object -First 20 | Out-Host
  }
} catch {
  Write-Warn "list-models 失败（可能未登录）：$_"
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "agent" -Value $existing
  Update-AgentToolPath -Key "cursorAgentTrust" -Value "true"
}

Write-Host ""
Write-Host "下一步（需人工登录）：" -ForegroundColor White
Write-Host "  agent login"
Write-Host "  或: powershell -NoProfile -ExecutionPolicy Bypass -File `"$existing`" login"
