# 启动 NapCat（会自动带上 QQ）。
#
# 为什么要用这个脚本而不是直接双击 launcher-user.bat：
#   NapCat 的 launcher 用 %cd% 找自己的文件（qqnt.json / napcat.mjs / 注入 dll），
#   所以必须"在 NapCat 自己的目录里"运行它。直接双击别的目录里的快捷方式、
#   或者在项目目录里用全路径调用它，都会因为 cwd 不对而启动失败（或只拉起一个没有 NapCat 的 QQ）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File deploy\start-napcat.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\start-napcat.ps1 -NapCatRoot D:\NapCat
#   powershell -ExecutionPolicy Bypass -File deploy\start-napcat.ps1 -QuickLogin 123456789   # 免扫码快速登录
#   powershell -ExecutionPolicy Bypass -File deploy\start-napcat.ps1 -Elevated               # QQ 装在 Program Files 时自动提权
param(
    [string]$NapCatRoot = '',
    [string]$QuickLogin = '',
    [string]$QQPath = '',
    [switch]$DryRun,
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "[napcat] $msg" }

function Test-ExistsSafe($path) {
    # 遇到"不存在的盘符"时 Join-Path/Test-Path 会抛 DriveNotFoundException，
    # 结合 ErrorActionPreference=Stop 就成了致命错误，所以一律用这个安全的判断。
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
    foreach ($p in @('NapCat', 'Documents\NapCat', 'Desktop\NapCat', 'Downloads\NapCat')) {
        $candidates += (Join-Path $env:USERPROFILE $p)
    }
    if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'NapCat') }
    $candidates += 'C:\Users\Public\NapCat'

    foreach ($c in ($candidates | Select-Object -Unique)) {
        if (Test-ExistsSafe (Join-Path $c 'launcher-user.bat')) { return $c }
    }

    # 2. 一键包 / 便携包（MaiBot 一键包就把 NapCat 放在这下面）
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

    # 3. 最后浅扫盘（只扫两层）
    foreach ($root in (Get-FileSystemRoots)) {
        $hit = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue } |
            Where-Object { Test-ExistsSafe (Join-Path $_.FullName 'launcher-user.bat') } |
            Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

if (-not $NapCatRoot) {
    $NapCatRoot = Find-NapCatRoot
    if (-not $NapCatRoot) {
        Write-Host ''
        Write-Host '[napcat] 没找到 NapCat。' -ForegroundColor Yellow
        Write-Host '  安装：双击 deploy\install-napcat.bat'
        Write-Host '  装在别处：加参数 -NapCatRoot D:\NapCat'
        exit 1
    }
    Step "找到 NapCat：$NapCatRoot"
}

$launcher = Join-Path $NapCatRoot 'launcher-user.bat'
if (-not (Test-Path $launcher)) { throw "这里没有 launcher-user.bat：$NapCatRoot" }

$napcatMain = Join-Path $NapCatRoot 'napcat.mjs'
if (-not (Test-Path $napcatMain)) {
    Write-Host '[napcat] 警告：这个目录里没有 napcat.mjs，可能不是 NapCat 的根目录（或没解压完整）。' -ForegroundColor Yellow
}

# ---- 权限检查：NapCat 要往 QQ 自己的安装目录里写 loadNapCat.js，Program Files 下非管理员写不进去 ----
function Test-IsAdmin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Get-QQInstallPath {
    try {
        $reg = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ' -ErrorAction SilentlyContinue
        if (-not $reg -or -not $reg.UninstallString) {
            $reg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QQ' -ErrorAction SilentlyContinue
        }
        if ($reg -and $reg.UninstallString) {
            $dir = Split-Path -Parent ($reg.UninstallString -replace '"', '')
            if ($dir) { return (Join-Path $dir 'QQ.exe') }
        }
    } catch { }
    return $null
}

$isAdmin = Test-IsAdmin
$qqExe = if ($QQPath) { $QQPath } else { Get-QQInstallPath }
$qqProtected = $false
if ($qqExe) {
    $qqProtected = ($qqExe -like 'C:\Program Files\*') -or ($qqExe -like 'C:\Program Files (x86)\*') -or ($qqExe -like 'C:\Windows\*')
}
$needsAdmin = $qqProtected -and -not $isAdmin

if ($needsAdmin) {
    Write-Host ''
    Write-Host '[napcat] 需要管理员权限。' -ForegroundColor Yellow
    Write-Host "  QQ 装在：$qqExe"
    Write-Host '  NapCat 要改写 QQ 目录里的文件（把 Electron 入口换成 loadNapCat.js），而 Program Files 只有管理员能写。'
    Write-Host '  不提权的话，QQ 会弹 "A JavaScript error occurred in the main process / Cannot find module ...loadNapCat.js"。'
    Write-Host ''
    if ($Elevated -and -not $DryRun) {
        Step '正在以管理员身份重新启动（会弹 UAC 确认框，点"是"）…'
        $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Elevated', '-NapCatRoot', $NapCatRoot)
        if ($QuickLogin) { $argList += @('-QuickLogin', $QuickLogin) }
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList
        exit 0
    }
    Write-Host '  两种做法，任选一种：' -ForegroundColor Cyan
    Write-Host '   A. 命令行执行：  deploy\start-napcat.bat -Elevated     （自动提权，推荐）'
    Write-Host '   B. 开始菜单搜索 PowerShell → 右键「以管理员身份运行」→ 执行：'
    Write-Host "        cd /d $NapCatRoot"
    Write-Host '        .\launcher-user.bat'
    Write-Host ''
    Write-Host '  另一种彻底省事的办法：把 QQ 装到不受保护的位置（例如 D:\QQ），就不用管理员了。'
    Write-Host ''
    if (-not $DryRun) { exit 1 }
    Write-Host '[napcat] （-DryRun：只提示，不启动）' -ForegroundColor Cyan
}

Step '启动 QQ + NapCat（第一次需要手机扫码登录机器人小号）…'
if ($DryRun) {
    Step '（-DryRun：只检查路径，不真的启动 QQ）'
    Step "NapCat 目录：$NapCatRoot"
    Step "启动器：$launcher"
    Step ("napcat.mjs：" + $(if (Test-Path $napcatMain) { '存在 ✓' } else { '缺失 ✗' }))
    exit 0
}
Set-Location $NapCatRoot
if ($QuickLogin) {
    Step "使用快速登录：$QuickLogin"
    & cmd /c "`"$launcher`" $QuickLogin"
} else {
    & cmd /c "`"$launcher`""
}

Write-Host ''
Step 'QQ/NapCat 已退出。'
Write-Host '如果启动失败，检查：' -ForegroundColor Cyan
Write-Host '  1. 这台机器上装过 QQ 并且能正常登录（注册表里有 QQ 的安装信息）'
Write-Host '  2. QQ 版本和 NapCat 支持的范围一致（版本过新时 NapCat 会提示）'
Write-Host '  3. 需要管理员权限的话，右键用管理员身份运行 launcher.bat（本脚本用的是免管理员的 launcher-user.bat）'
