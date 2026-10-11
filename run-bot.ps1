# 守护运行：程序意外崩溃会自动重启（正常退出不会重启）。
# 用法： powershell -ExecutionPolicy Bypass -File run-bot.ps1 [-DryRun]
param(
    [switch]$DryRun,
    [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Stop'
# 项目根目录：从脚本所在目录往上找，直到看见 package.json
$root = $PSScriptRoot
while ($root -and -not (Test-Path (Join-Path $root 'package.json'))) {
    $parent = Split-Path -Parent $root
    if (-not $parent -or $parent -eq $root) { break }
    $root = $parent
}
Set-Location $root

$nodeExe = Join-Path $root '.runtime\node\node.exe'
if (-not (Test-Path $nodeExe)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $nodeExe = $cmd.Source }
}
if (-not $nodeExe -or -not (Test-Path $nodeExe)) {
    Write-Host '[qq-ai-chat] 找不到 Node，请先运行 install-node.ps1'
    exit 1
}

$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$supervisorLog = Join-Path $logDir 'supervisor.log'

function Write-Supervisor($message) {
    $line = "[{0}] {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $message
    Write-Host $line
    Add-Content -Path $supervisorLog -Value $line -Encoding UTF8
}

$script = Join-Path $root 'src\index.mjs'
Write-Supervisor "[qq-ai-chat] 守护模式启动（Node: $nodeExe）"

while ($true) {
    $args = @($script)
    if ($DryRun) { $args += '--dry-run' }
    & $nodeExe @args
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        Write-Supervisor '[qq-ai-chat] 程序正常退出，守护模式结束。'
        break
    }
    Write-Supervisor "[qq-ai-chat] 程序异常退出（代码 $code），$RestartDelaySeconds 秒后重启…"
    Start-Sleep -Seconds $RestartDelaySeconds
}
