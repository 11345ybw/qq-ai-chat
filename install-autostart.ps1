# 注册开机自启：登录 Windows 后自动在后台把机器人跑起来（守护模式）。
# 用法： powershell -ExecutionPolicy Bypass -File install-autostart.ps1
param(
    [string]$TaskName = 'QQAIChat'
)

$ErrorActionPreference = 'Stop'
# 项目根目录：从脚本所在目录往上找，直到看见 package.json
$root = $PSScriptRoot
while ($root -and -not (Test-Path (Join-Path $root 'package.json'))) {
    $parent = Split-Path -Parent $root
    if (-not $parent -or $parent -eq $root) { break }
    $root = $parent
}
$runner = Join-Path $root 'run-bot.ps1'

if (-not (Test-Path $runner)) { throw "找不到 $runner" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$runner`"" `
    -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force `
    -Description 'qq-ai-chat：QQ 里的 AI 角色，会回复也会在沉默时主动开口' | Out-Null

Write-Host "[qq-ai-chat] 已注册计划任务：$TaskName（下次登录 Windows 后自动启动）"
Write-Host "           想立刻启动：Start-ScheduledTask -TaskName $TaskName"
Write-Host "           取消自启：  uninstall-autostart.bat"
