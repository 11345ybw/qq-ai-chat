# 自动把 NapCat 的 OneBot 11 通道配好（省掉手点 WebUI 那一步）。
#
# 它会做两件事（对每个已登录过的 QQ 号各做一遍，写前先备份）：
#   ① 开一个「HTTP 服务器」：127.0.0.1:3000，token = ApiToken      → 我们用它发消息
#   ② 开一个「HTTP 上报」：http://127.0.0.1:8787/onebot，secret = ReportToken → NapCat 用它把消息推给我们
# 这两个 token 和 config.json 里的默认值一致，所以配置不需要另外改。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File deploy\setup-napcat.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\setup-napcat.ps1 -NapCatRoot D:\NapCat
#
# 注意：必须先在 NapCat 里登录过一次 QQ（登录后它才会生成 onebot11_<QQ号>.json）。
param(
    [string]$NapCatRoot = '',
    [int]$ApiPort = 3000,
    [string]$ApiToken = 'change-me-please',
    [int]$ReportPort = 8787,
    [string]$ReportToken = 'change-me-please',
    [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Step($msg) { Write-Host "[napcat-config] $msg" }

function Test-ExistsSafe($path) {
    # 注意：Join-Path/Test-Path 遇到"不存在的盘符"会抛 DriveNotFoundException，
    # 而本脚本 ErrorActionPreference=Stop 会把它变成致命错误，所以一律包起来。
    if (-not $path) { return $false }
    try { return [System.IO.File]::Exists($path) -or [System.IO.Directory]::Exists($path) } catch { return $false }
}

function Get-FileSystemRoots {
    try {
        return @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
            Where-Object { $_.Root -and $_.Root -match '^[A-Za-z]:\\' } |
            ForEach-Object { $_.Root })
    } catch {
        return @()
    }
}

function Find-NapCatRoot {
    # 1. 每个真实存在的盘根目录下的 NapCat（不再硬写 C:/D:/E:）
    $candidates = @()
    foreach ($root in (Get-FileSystemRoots)) {
        $candidates += ($root.TrimEnd('\') + '\NapCat')
    }
    # 2. 常见用户目录
    foreach ($p in @('NapCat', 'Documents\NapCat', 'Desktop\NapCat', 'Downloads\NapCat')) {
        $candidates += (Join-Path $env:USERPROFILE $p)
    }
    if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'NapCat') }
    $candidates += 'C:\Users\Public\NapCat'

    foreach ($c in ($candidates | Select-Object -Unique)) {
        if (Test-ExistsSafe (Join-Path $c 'config\webui.json')) { return $c }
        if (Test-ExistsSafe (Join-Path $c 'launcher-user.bat')) { return $c }
    }

    # 3. 一键包 / 便携包常见位置（MaiBot 一键包就把 NapCat 放在这下面）
    $parents = @()
    if ($env:APPDATA) { $parents += (Join-Path $env:APPDATA 'MaiBotOneKeyDesktop') }
    if ($env:LOCALAPPDATA) { $parents += (Join-Path $env:LOCALAPPDATA 'Programs') }
    $parents += (Join-Path $env:USERPROFILE 'Desktop')
    $parents += (Join-Path $env:USERPROFILE 'Downloads')
    foreach ($base in $parents) {
        if (-not (Test-ExistsSafe $base)) { continue }
        $hit = Get-ChildItem $base -Recurse -Depth 6 -Filter 'launcher-user.bat' -File -ErrorAction SilentlyContinue |
            Where-Object { Test-ExistsSafe (Join-Path $_.DirectoryName 'napcat.mjs') } |
            Select-Object -First 1
        if ($hit) { return $hit.DirectoryName }
    }

    # 4. 最后才浅扫盘（只扫两层，避免在整盘上卡几分钟）
    foreach ($root in (Get-FileSystemRoots)) {
        $hit = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue } |
            Where-Object { Test-ExistsSafe (Join-Path $_.FullName 'config\webui.json') } |
            Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

if (-not $NapCatRoot) {
    $NapCatRoot = Find-NapCatRoot
    if (-not $NapCatRoot) {
        Write-Host ''
        Write-Host '[napcat-config] 没找到 NapCat 目录。' -ForegroundColor Yellow
        Write-Host '  1) 还没装：先运行 deploy\install-napcat.bat'
        Write-Host '  2) 装在别处：加参数指定，例如  deploy\setup-napcat.bat -NapCatRoot D:\NapCat'
        Write-Host '     （该目录里应有 launcher-user.bat 与 config\webui.json；只有 config 没有 webui.json 说明 NapCat 还没成功启动/登录过）'
        exit 1
    }
    Step "自动找到 NapCat 目录：$NapCatRoot"
}

$configDir = Join-Path $NapCatRoot 'config'
if (-not (Test-Path $configDir)) { throw "这个目录下没有 config\：$NapCatRoot" }

$files = Get-ChildItem $configDir -Filter 'onebot11_*.json' -ErrorAction SilentlyContinue
if (-not $files -or $files.Count -eq 0) {
    Write-Host ''
    Write-Host '[napcat-config] 这个目录里还没有 onebot11_<QQ号>.json' -ForegroundColor Yellow
    Write-Host "  → 说明还没在 NapCat 里登录过 QQ。请先：双击 $NapCatRoot\launcher-user.bat，扫码登录机器人小号，然后重新运行本脚本。"
    exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$patched = @()

foreach ($file in $files) {
    $uin = $file.BaseName -replace '^onebot11_', ''
    $json = [System.IO.File]::ReadAllText($file.FullName, $utf8NoBom) | ConvertFrom-Json

    if (-not $json.network) {
        $json | Add-Member -NotePropertyName network -NotePropertyValue (New-Object psobject) -Force
    }
    foreach ($prop in @('httpServers', 'httpSseServers', 'httpClients', 'websocketServers', 'websocketClients', 'plugins')) {
        if (-not $json.network.PSObject.Properties[$prop]) {
            $json.network | Add-Member -NotePropertyName $prop -NotePropertyValue @() -Force
        }
    }

    # ① HTTP 服务器：我们去调它发消息
    $api = @{
        enable = $true
        name = 'qq-ai-chat-api'
        host = '127.0.0.1'
        port = $ApiPort
        enableCors = $true
        messagePostFormat = 'array'
        token = $ApiToken
        debug = $false
        heartInterval = 30000
    }
    $servers = @($json.network.httpServers | Where-Object { $_.name -ne 'qq-ai-chat-api' })
    $servers += $api
    $json.network.httpServers = $servers

    # ② HTTP 上报：它把收到的 QQ 消息推给我们
    $report = @{
        enable = $true
        name = 'qq-ai-chat-report'
        url = "http://127.0.0.1:$ReportPort/onebot"
        reportSelfMessage = $false
        messagePostFormat = 'array'
        token = $ReportToken
        debug = $false
        heartInterval = 30000
    }
    $clients = @($json.network.httpClients | Where-Object { $_.name -ne 'qq-ai-chat-report' })
    $clients += $report
    $json.network.httpClients = $clients

    if (-not $NoBackup) {
        Copy-Item $file.FullName "$($file.FullName).bak-$stamp" -Force
    }
    $text = $json | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($file.FullName, $text + "`n", $utf8NoBom)
    $patched += $uin
    Step "已配置 QQ $uin ：HTTP 服务器 $ApiPort + HTTP 上报 http://127.0.0.1:$ReportPort/onebot"
}

# 顺手把 WebUI 的 token 打印出来，省得去翻文件
$webui = Join-Path $configDir 'webui.json'
if (Test-Path $webui) {
    try {
        $w = [System.IO.File]::ReadAllText($webui, $utf8NoBom) | ConvertFrom-Json
        Step "NapCat WebUI：http://127.0.0.1:$($w.port)/webui?token=$($w.token)"
    } catch { }
}

Write-Host ''
Step "完成 ✓ 共配置 $($patched.Count) 个账号：$($patched -join ', ')"
Write-Host '现在重启 NapCat（关掉 launcher 窗口重新双击），然后回项目目录跑 check.bat' -ForegroundColor Cyan
Write-Host "  - token 用的是：API=$ApiToken  上报=$ReportToken（与 config.json 默认值一致）"
Write-Host "  - 原配置已备份为 *.bak-$stamp"
