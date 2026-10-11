# 只结束"命令行里包含本项目 src\index.mjs 的 node 进程"，不会误杀别的 Node 程序
$ErrorActionPreference = 'Stop'
# 项目根目录：从脚本所在目录（scripts\）往上找，直到看见 package.json
$root = $PSScriptRoot
while ($root -and -not (Test-Path (Join-Path $root 'package.json'))) {
    $parent = Split-Path -Parent $root
    if (-not $parent -or $parent -eq $root) { break }
    $root = $parent
}
$pattern = [regex]::Escape((Join-Path $root 'src\index.mjs'))

$targets = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }

if (-not $targets) {
    Write-Host "[qq-ai-chat] 没有正在运行的机器人进程。"
    exit 0
}

Write-Host "[qq-ai-chat] 找到以下进程："
foreach ($t in $targets) {
    Write-Host ("  PID {0}  {1}" -f $t.ProcessId, $t.CommandLine)
}

$answer = Read-Host "确认结束这些进程吗？(y/N)"
if ($answer -ne 'y' -and $answer -ne 'Y') {
    Write-Host "已取消。"
    exit 0
}

foreach ($t in $targets) {
    try {
        Stop-Process -Id $t.ProcessId -Force
        Write-Host ("  已结束 PID {0}" -f $t.ProcessId)
    } catch {
        Write-Host ("  结束 PID {0} 失败：{1}" -f $t.ProcessId, $_.Exception.Message)
    }
}

# 顺手清掉可能残留的单实例锁
$lock = Join-Path $root 'data\bot.lock'
if (Test-Path $lock) { Remove-Item $lock -Force; Write-Host "  已清理 data\bot.lock" }
