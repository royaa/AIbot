#Requires -Version 5.1
<#
.SYNOPSIS
  安装 OpenAI Codex CLI，并写入 agent.config.json 的 tools.codex
.NOTES
  官方：irm https://chatgpt.com/codex/install.ps1 | iex
  备选：npm i -g @openai/codex  /  winget install OpenAI.Codex
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipConfig,
  [ValidateSet("official", "npm", "winget")]
  [string]$Method = "official"
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "OpenAI Codex CLI"

function Resolve-CodexPath {
  $fromPath = Find-OnPath "codex"
  if ($fromPath) { return $fromPath }
  return Find-FirstExisting @(
    "$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin\codex.exe",
    "$env:LOCALAPPDATA\OpenAI\Codex\bin\codex.exe",
    "$env:APPDATA\npm\codex.cmd",
    "$env:APPDATA\npm\codex.exe"
  )
}

$existing = Resolve-CodexPath
if ($existing -and -not $SkipInstall) {
  Write-Ok "已安装: $existing"
} elseif (-not $existing) {
  if ($SkipInstall) { throw "未找到 Codex，且指定了 -SkipInstall" }
  Write-Step "安装 Codex（方式: $Method）"
  switch ($Method) {
    "official" {
      try {
        Invoke-RestMethod https://chatgpt.com/codex/install.ps1 | Invoke-Expression
      } catch {
        Write-Warn "官方脚本失败: $_"
        Write-Warn "尝试 npm…"
        npm install -g @openai/codex
      }
    }
    "npm" {
      npm install -g @openai/codex
    }
    "winget" {
      if (-not (Test-Winget)) { throw "本机无 winget" }
      winget install -e --id OpenAI.Codex --accept-package-agreements --accept-source-agreements
    }
  }
  $existing = Resolve-CodexPath
  if (-not $existing) {
    throw "安装后仍找不到 codex。请新开终端后重试，或检查 %LOCALAPPDATA%\Programs\OpenAI\Codex\bin"
  }
  Write-Ok "安装完成: $existing"
}

try {
  & $existing --version 2>&1 | Out-Host
} catch {
  Write-Warn "无法执行 --version：$_"
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "codex" -Value $existing
}

Write-Host ""
Write-Host "下一步（需人工登录）：" -ForegroundColor White
Write-Host "  codex"
Write-Host "  或: & `"$existing`""
Write-Host "按提示用 ChatGPT 账号登录后，再用手机选 Codex。"
