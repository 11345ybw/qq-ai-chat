# prepare-release.ps1 - build a release zip that actually works on Chinese Windows.
#
# ASCII-only on purpose: this script must run even when the console codepage is 936.
#
# What it does:
#   1. verifies every .bat is pure ASCII  (cmd.exe reads .bat as the OEM codepage = GBK on zh-CN,
#      so non-ASCII bytes there get mangled and can split a line into bogus commands)
#   2. adds a UTF-8 BOM to every .ps1     (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI/GBK)
#   3. runs the test suite
#   4. builds qq-ai-chat-v<version>.zip, excluding config.json / secrets.json / data / logs / .runtime
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-release.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-release.ps1 -NodeExe "C:\path\to\node.exe"

param(
    [string]$NodeExe = '',
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)

# directories we never touch while scanning for sources to fix / ship
$skipDirs = @('.runtime', 'node_modules', '.git', '.pack', '.tmp-mock', 'data', 'logs')

function Get-SourceFiles($filter) {
    Get-ChildItem $root -Recurse -Filter $filter -Force | Where-Object {
        $rel = $_.FullName.Substring($root.Length + 1)
        $top = ($rel -split '\\')[0]
        $skipDirs -notcontains $top
    }
}

# ---------- 1. .bat must be ASCII ----------
$bad = @()
Get-SourceFiles '*.bat' | ForEach-Object {
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $nonAscii = 0
    foreach ($b in $bytes) { if ($b -gt 127) { $nonAscii++ } }
    if ($nonAscii -gt 0) { $bad += "$($_.Name) ($nonAscii non-ASCII bytes)" }
}
if ($bad.Count) {
    Write-Host '[FAIL] these .bat files contain non-ASCII bytes and will break cmd.exe:' -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "       $_" }
    exit 1
}
Write-Host '[ok] all .bat files are pure ASCII'

# ---------- 2. .ps1 need UTF-8 BOM for Windows PowerShell 5.1 ----------
# (this includes this script itself: PowerShell 5.1 reads a BOM-less UTF-8 .ps1 as ANSI/GBK)
Get-SourceFiles '*.ps1' | ForEach-Object {
    $text = [System.IO.File]::ReadAllText($_.FullName)
    [System.IO.File]::WriteAllText($_.FullName, $text, $utf8Bom)
}
Write-Host '[ok] .ps1 files saved as UTF-8 with BOM'

# ---------- 2.5 secret scan: never ship or commit a real API key ----------
$scanner = Join-Path $root 'scripts\check-secrets.ps1'
if (Test-Path $scanner) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $scanner -Root $root
    if ($LASTEXITCODE -ne 0) { Write-Host '[FAIL] secret scan failed, aborting' -ForegroundColor Red; exit 1 }
} else {
    Write-Host '[skip] scripts\check-secrets.ps1 not found' -ForegroundColor Yellow
}

# ---------- 3. tests ----------
if (-not $SkipTests) {
    if (-not $NodeExe) {
        $portable = Join-Path $root '.runtime\node\node.exe'
        if (Test-Path $portable) { $NodeExe = $portable }
        else {
            $cmd = Get-Command node -ErrorAction SilentlyContinue
            if ($cmd) { $NodeExe = $cmd.Source }
        }
    }
    if (-not $NodeExe -or -not (Test-Path $NodeExe)) {
        Write-Host '[skip] node not found, tests skipped (pass -NodeExe to run them)' -ForegroundColor Yellow
    } else {
        Write-Host "[..] running tests with $NodeExe"
        Push-Location $root
        & $NodeExe --test
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Write-Host '[FAIL] tests failed, zip not built' -ForegroundColor Red; exit 1 }
        Write-Host '[ok] tests passed'
    }
}

# ---------- 4. build zip ----------
$pkgPath = Join-Path $root 'package.json'
$pkgText = [System.IO.File]::ReadAllText($pkgPath, (New-Object System.Text.UTF8Encoding($false)))
$pkg = $pkgText | ConvertFrom-Json
$version = $pkg.version
$zip = Join-Path (Split-Path -Parent $root) "qq-ai-chat-v$version.zip"
$stage = Join-Path (Split-Path -Parent $root) ".pack\qq-ai-chat"

$excludeDirs = @('data', 'logs', '.tmp-mock', '.runtime', 'node_modules', '.git')
$excludeFiles = @('config.json', 'secrets.json')

if (Test-Path (Split-Path -Parent $stage)) { Remove-Item (Split-Path -Parent $stage) -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Get-ChildItem $root -Recurse -Force | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $top = ($rel -split '\\')[0]
    if ($_.PSIsContainer) {
        if ($excludeDirs -contains $top) { return }
        New-Item -ItemType Directory -Force -Path (Join-Path $stage $rel) | Out-Null
        return
    }
    if ($excludeDirs -contains $top) { return }
    if ($excludeFiles -contains $_.Name) { return }
    $destDir = Join-Path $stage (Split-Path -Parent $rel)
    if ($destDir -and -not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    Copy-Item $_.FullName (Join-Path $stage $rel) -Force
}

Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal -Force
Remove-Item (Split-Path -Parent $stage) -Recurse -Force

# sanity: no secrets in the package
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
$leak = $archive.Entries | Where-Object { $_.FullName -match '(secrets\.json|config\.json|/data/|/logs/|\.runtime)' -and $_.FullName -notmatch '\.example\.json' }
$count = $archive.Entries.Count
$archive.Dispose()
if ($leak) {
    Write-Host '[FAIL] package contains files that should not ship:' -ForegroundColor Red
    $leak | ForEach-Object { Write-Host "       $($_.FullName)" }
    exit 1
}

$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)

# ---------- 5. smoke test: extract and run the launchers the way a user double-clicks them ----------
# This catches the classic "it worked in the repo but not after unzip" bugs:
# wrong %~dp0 / $PSScriptRoot root detection, .bat encoding problems, missing files.
if ($NodeExe -and (Test-Path $NodeExe)) {
    $tmp = Join-Path $env:TEMP ("qq-ai-chat-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $proj = Join-Path $tmp 'qq-ai-chat'
        $fakeRuntime = Join-Path $proj '.runtime\node'
        New-Item -ItemType Directory -Force -Path $fakeRuntime | Out-Null
        Copy-Item $NodeExe (Join-Path $fakeRuntime 'node.exe') -Force
        # an empty secrets.json so the app can start far enough to print status
        [System.IO.File]::WriteAllText((Join-Path $proj 'secrets.json'), '{"deepseekApiKey":"sk-smoke-test"}', $utf8NoBom)

        $outFile = Join-Path $tmp 'smoke.out'
        $cmd = "cd /d `"$proj`" && start.bat --status < nul > `"$outFile`" 2>&1"
        $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -Wait -PassThru -WindowStyle Hidden
        $out = if (Test-Path $outFile) { [System.IO.File]::ReadAllText($outFile) } else { '' }

        $problems = @()
        if ($p.ExitCode -ne 0) { $problems += "start.bat exited with code $($p.ExitCode)" }
        if ($out -notmatch [regex]::Escape($proj)) { $problems += 'start.bat did not reach the app (portable node not found? root path wrong?)' }
        if ($out -match 'is not recognized as an internal or external command') { $problems += 'cmd reported a broken command line (batch parsing/encoding problem)' }
        if ($out -match 'Node.js not found') { $problems += 'launcher says Node.js not found even though .runtime\node\node.exe exists' }

        if ($problems.Count) {
            Write-Host '[FAIL] extracted-package smoke test failed:' -ForegroundColor Red
            $problems | ForEach-Object { Write-Host "       $_" }
            Write-Host '       --- output was ---'
            $out -split "`n" | Select-Object -First 15 | ForEach-Object { Write-Host "       $_" }
            exit 1
        }
        Write-Host '[ok] extracted package runs: start.bat --status reached the app'
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host '[skip] extraction smoke test skipped (no node available)' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "[ok] release built: $zip ($size KB, $count entries)" -ForegroundColor Green
