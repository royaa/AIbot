#Requires -Version 5.1
<#
.SYNOPSIS
  安装 Factory Droid CLI，并把路径写入 agent.config.json 的 tools.droid
.NOTES
  官方文档：https://docs.bigmodel.cn/cn/coding-plan/tool/droid
  Windows 安装：irm https://app.factory.ai/cli/windows | iex
  密钥配置：客户端「CLI 配置」写入 BYOK（~/.factory/settings.json customModels）
  注意：首次运行 droid 需浏览器登录 Factory 账户（海外手机号验证）
#>
param(
  [switch]$SkipInstall,
  [switch]$SkipConfig
)

. "$PSScriptRoot\_lib.ps1"

Write-Step "Factory Droid CLI"

function Resolve-DroidPath {
  $fromPath = Find-OnPath "droid"
  if ($fromPath) { return $fromPath }
  return Find-FirstExisting @(
    "$env:USERPROFILE\.factory\bin\droid.exe",
    "$env:LOCALAPPDATA\Programs\factory\droid.exe",
    "$env:LOCALAPPDATA\Factory\Droid\droid.exe"
  )
}

$existing = Resolve-DroidPath
if ($existing -and $SkipInstall) {
  Write-Ok "已找到: $existing"
} elseif ($existing -and -not $SkipInstall) {
  Write-Ok "已安装: $existing（跳过下载；加 -SkipInstall 可仅探测）"
} else {
  Write-Step "运行官方安装脚本（app.factory.ai）"
  try {
    Invoke-RestMethod https://app.factory.ai/cli/windows | Invoke-Expression
  } catch {
    throw "官方安装脚本失败: $_。请手动: irm https://app.factory.ai/cli/windows | iex"
  }
  $existing = Resolve-DroidPath
  if (-not $existing) {
    Write-Warn "安装后当前终端找不到 droid（安装器常只对新终端生效）。"
    Write-Warn "请新开 PowerShell 后重跑本脚本加 -SkipInstall 完成登记。"
    if (-not $SkipConfig) {
      # 先登记裸命令名，重启 Agent 后 probe 会按 PATH 解析
      Update-AgentToolPath -Key "droid" -Value "droid"
    }
    return
  }
  Write-Ok "安装完成: $existing"
}

try {
  & $existing --version 2>&1 | Out-Host
} catch {
  Write-Warn "无法执行 --version（可能需新开终端）：$_"
}

if (-not $SkipConfig) {
  Update-AgentToolPath -Key "droid" -Value $existing
}

Write-Host ""
Write-Host "下一步：" -ForegroundColor White
Write-Host "  客户端「CLI 配置 → Droid」填入 API Key（BYOK 写入 ~/.factory/settings.json）"
Write-Host "  首次运行 droid 需浏览器登录 Factory 账户（需海外手机号验证）"
Write-Host "  启动后 /model 在 Custom models 分区选 GLM 模型"
