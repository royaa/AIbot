# Shared helpers for CLI installers (dot-source from sibling scripts).

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-AgentConfigPath {
  return Join-Path (Get-RepoRoot) "agent\agent.config.json"
}

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-Ok([string]$msg) {
  Write-Host "  OK  $msg" -ForegroundColor Green
}

function Write-Warn([string]$msg) {
  Write-Host "  !!  $msg" -ForegroundColor Yellow
}

function Find-FirstExisting([string[]]$candidates) {
  foreach ($c in $candidates) {
    if ([string]::IsNullOrWhiteSpace($c)) { continue }
    $expanded = [Environment]::ExpandEnvironmentVariables($c)
    if (Test-Path -LiteralPath $expanded) {
      return (Resolve-Path -LiteralPath $expanded).Path
    }
  }
  return $null
}

function Find-OnPath([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  return $null
}

function Find-NpmGlobal([string]$name) {
  # npm -g 在 Windows 的默认落点 %APPDATA%\npm（.cmd 包装器等）
  return Find-FirstExisting @(
    "$env:APPDATA\npm\$name.cmd",
    "$env:APPDATA\npm\$name.ps1",
    "$env:APPDATA\npm\$name.exe"
  )
}

function Update-AgentToolPath {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Value
  )
  $configPath = Get-AgentConfigPath
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "找不到 agent.config.json: $configPath"
  }

  $node = Find-OnPath "node"
  if (-not $node) {
    throw "需要 Node.js 才能安全写回 agent.config.json（本仓库本身依赖 Node）"
  }

  $env:GROKBOT_CFG_PATH = $configPath
  $env:GROKBOT_CFG_KEY = $Key
  $env:GROKBOT_CFG_VALUE = $Value
  # 写成临时文件再执行。PowerShell 5.1 调用 node -e 时会吃掉脚本里的引号。
  $script = @'
const fs = require("fs");
const pathMod = require("path");
const cfgPath = process.env.GROKBOT_CFG_PATH;
const key = process.env.GROKBOT_CFG_KEY;
const value = process.env.GROKBOT_CFG_VALUE;
function writeKey(file) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!cfg.tools || typeof cfg.tools !== "object") cfg.tools = {};
  cfg.tools[key] = value;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
writeKey(cfgPath);
const local = pathMod.join(pathMod.dirname(cfgPath), "agent.config.local.json");
if (fs.existsSync(local)) writeKey(local);
console.log(key + "=" + value);
'@
  $js = Join-Path ([IO.Path]::GetTempPath()) ("grokbot-cfg-" + [guid]::NewGuid().ToString("n") + ".js")
  [IO.File]::WriteAllText($js, $script.Trim(), (New-Object System.Text.UTF8Encoding $false))
  try {
    & $node $js | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "写回 agent.config.json 失败（exit=$LASTEXITCODE）"
    }
  } finally {
    Remove-Item -LiteralPath $js -Force -ErrorAction SilentlyContinue
    Remove-Item Env:GROKBOT_CFG_PATH, Env:GROKBOT_CFG_KEY, Env:GROKBOT_CFG_VALUE -ErrorAction SilentlyContinue
  }
  Write-Ok "已写入 agent.config.json → tools.$Key"
}

function Test-Winget {
  return [bool](Get-Command winget -ErrorAction SilentlyContinue)
}
