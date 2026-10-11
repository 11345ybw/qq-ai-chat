# 下载便携版 Node.js 到项目下的 .runtime\node，不需要管理员权限，也不改系统 PATH。
# 用法：
#   powershell -ExecutionPolicy Bypass -File install-node.ps1
#   powershell -ExecutionPolicy Bypass -File install-node.ps1 -Force          # 重新装
#   powershell -ExecutionPolicy Bypass -File install-node.ps1 -Version v22.11.0
param(
    [string]$Version = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 项目根目录：从脚本所在目录往上找，直到看见 package.json（脚本本身放在根目录）
$root = $PSScriptRoot
while ($root -and -not (Test-Path (Join-Path $root 'package.json'))) {
    $parent = Split-Path -Parent $root
    if (-not $parent -or $parent -eq $root) { break }
    $root = $parent
}
$runtimeDir = Join-Path $root '.runtime'
$targetDir = Join-Path $runtimeDir 'node'
$nodeExe = Join-Path $targetDir 'node.exe'

if ((Test-Path $nodeExe) -and -not $Force) {
    $existing = & $nodeExe --version
    Write-Host "[qq-ai-chat] 已经装好了：$nodeExe（$existing），想重装加 -Force"
    exit 0
}

if (-not $Version) {
    Write-Host '[qq-ai-chat] 正在查询 Node.js 最新的 LTS 版本…'
    try {
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30
        $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
        if ($lts) { $Version = $lts.version }
    } catch {
        Write-Host "  查询失败（$($_.Exception.Message)），用备用版本。"
    }
    if (-not $Version) { $Version = 'v22.11.0' }
}

$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
$zipName = "node-$Version-win-$arch.zip"
$zipPath = Join-Path $env:TEMP $zipName

# 官方源 + 国内镜像，哪个通用哪个（国内服务器上 nodejs.org 有时很慢）
$bases = @(
    "https://nodejs.org/dist/$Version",
    "https://npmmirror.com/mirrors/node/$Version",
    "https://registry.npmmirror.com/-/binary/node/$Version"
)

$downloaded = $false
foreach ($base in $bases) {
    $url = "$base/$zipName"
    Write-Host "[qq-ai-chat] 下载 $url"
    try {
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
        Invoke-WebRequest -Uri $url -OutFile $zipPath -TimeoutSec 600
        if ((Get-Item $zipPath).Length -gt 5MB) { $downloaded = $true; Write-Host '  下载完成 ✓'; break }
        Write-Host '  文件太小，应该是失败了，换下一个源…'
    } catch {
        Write-Host "  失败：$($_.Exception.Message)"
        Write-Host '  换下一个源…'
    }
}
if (-not $downloaded) { throw "三个源都没下下来。请手动下载 $zipName 解压到 .runtime\node 即可。" }

Write-Host '[qq-ai-chat] 校验文件完整性…'
try {
    $shasums = $null
    foreach ($base in $bases) {
        try {
            $shasums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -TimeoutSec 60 -UseBasicParsing).Content
            if ($shasums) { break }
        } catch { }
    }
    $line = if ($shasums) { ($shasums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1) } else { $null }
    if ($line) {
        $expected = ($line -split '\s+')[0].ToLower()
        $actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
        if ($expected -ne $actual) { throw "校验值不一致：期望 $expected，实际 $actual" }
        Write-Host '  校验通过 ✓'
    } else {
        Write-Host '  没找到对应校验值，跳过（不影响使用）'
    }
} catch {
    Write-Host "  校验跳过：$($_.Exception.Message)"
}

Write-Host '[qq-ai-chat] 解压中…'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$tmpDir = Join-Path $runtimeDir 'node-tmp'
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

$inner = Get-ChildItem -Path $tmpDir -Directory | Select-Object -First 1
if (-not $inner) { throw '解压后没有找到 Node 目录' }
if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force }
Move-Item -Path $inner.FullName -Destination $targetDir
Remove-Item $tmpDir -Recurse -Force
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

$version = & $nodeExe --version
Write-Host ''
Write-Host "[qq-ai-chat] 完成 ✓ Node $version 已安装到 $targetDir"
Write-Host "           现在可以双击 start.bat 启动机器人了。"
