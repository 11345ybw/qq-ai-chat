# 在 Windows 服务器上安装 NapCat（Shell 版）。
# 用法（在服务器上，用管理员 PowerShell 或普通 PowerShell 都行）：
#   powershell -ExecutionPolicy Bypass -File deploy\install-napcat.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\install-napcat.ps1 -TargetDir D:\NapCat
#   powershell -ExecutionPolicy Bypass -File deploy\install-napcat.ps1 -MirrorPrefix "https://ghproxy.net/"
# 
# 说明：脚本只负责把 NapCat 解压到位；QQ 本体和扫码登录必须你手动做（见输出的下一步）。
# 之所以还建议准备手动下载：部分国内服务器连不上 GitHub。脚本失败时它会直接给你下载地址。
param(
    [string]$TargetDir = 'C:\NapCat',
    [string]$Version = '',
    [string]$MirrorPrefix = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($msg) { Write-Host "[napcat] $msg" }

if ((Test-Path (Join-Path $TargetDir 'launcher-user.bat')) -and -not $Force) {
    Step "看起来已经装过了：$TargetDir（想覆盖重装加 -Force）"
    exit 0
}

$api = 'https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest'
if ($Version) { $api = "https://api.github.com/repos/NapNeko/NapCatQQ/releases/tags/$Version" }

Step '查询 NapCat 最新版本…'
$release = $null
try {
    $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'qq-ai-chat' } -TimeoutSec 30
    Step "最新版本：$($release.tag_name)"
} catch {
    Step "查询失败：$($_.Exception.Message)"
}

$zipUrl = $null
if ($release) {
    $asset = $release.assets | Where-Object { $_.name -eq 'NapCat.Shell.zip' } | Select-Object -First 1
    if (-not $asset) { $asset = $release.assets | Where-Object { $_.name -like 'NapCat.Shell*.zip' } | Select-Object -First 1 }
    if ($asset) { $zipUrl = $asset.browser_download_url }
}

if (-not $zipUrl) {
    Write-Host ''
    Write-Host '没能自动拿到下载地址。请手动做这两步：' -ForegroundColor Yellow
    Write-Host '  1. 浏览器打开 https://github.com/NapNeko/NapCatQQ/releases'
    Write-Host '  2. 下载 NapCat.Shell.zip，解压到本机（例如 C:\NapCat），然后双击里面的 launcher-user.bat'
    Write-Host ''
    Write-Host '（国内网络连不上 GitHub 时，可以用迅雷/浏览器下载，或换个网络环境）'
    exit 1
}

$zipPath = Join-Path $env:TEMP 'NapCat.Shell.zip'
$finalUrl = if ($MirrorPrefix) { "$MirrorPrefix$zipUrl" } else { $zipUrl }
Step "下载 $finalUrl"
try {
    Invoke-WebRequest -Uri $finalUrl -OutFile $zipPath -TimeoutSec 600
} catch {
    Step "下载失败：$($_.Exception.Message)"
    Write-Host ''
    Write-Host "请手动下载：$zipUrl" -ForegroundColor Yellow
    Write-Host "解压到 $TargetDir 后双击 launcher-user.bat" -ForegroundColor Yellow
    exit 1
}

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Step "下载完成（$sizeMB MB），解压到 $TargetDir"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $TargetDir -Force
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

Write-Host ''
Step "完成 ✓ NapCat 已解压到 $TargetDir"
Write-Host ''
Write-Host '接下来（必须手动）：' -ForegroundColor Cyan
Write-Host '  1. 在这台服务器上装 QQ：https://im.qq.com/pcqq （或用 NapCat 官方一键脚本，会自动下匹配版本）'
Write-Host '  2. 手动启动一次 QQ，用【机器人小号】扫码登录，确认能进主界面，然后退出'
Write-Host "  3. 双击 $TargetDir\launcher-user.bat —— 它会拉起 QQ 并注入 NapCat"
Write-Host '  4. 扫码登录机器人小号（之前登录过可跳过扫码）'
Write-Host '  5. 回到本项目目录，运行 setup-napcat.bat 自动把 OneBot 通道配好'
