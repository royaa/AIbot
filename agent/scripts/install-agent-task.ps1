$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$entry = Join-Path $root "dist\index.js"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$entry`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "AIBotAgent" -Action $action -Trigger $trigger -Description "AI Bot PC Agent" -Force
Write-Host "已注册计划任务 AIBotAgent（登录时启动）"
