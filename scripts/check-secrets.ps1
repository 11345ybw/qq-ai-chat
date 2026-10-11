# 密钥扫描门禁：防止把真实的 API key / token 提交进仓库或打进发布包。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\check-secrets.ps1
# 退出码 0 = 干净；1 = 发现可疑密钥（会列出文件与行号）
#
# 判定规则：形如 sk-<24 个以上字母数字> 的字符串视为"真 key"。
# 明显的测试用假 key（含 testonly / fake / example / dummy / xxx 等字样）会被放行。
# 忽略目录：data / logs / .runtime / node_modules / .tmp-mock / .git / .pack
param(
    [string]$Root = '',
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }

$skipDirs = @('.git', 'data', 'logs', '.runtime', 'node_modules', '.tmp-mock', '.pack', '.verify')
$skipFiles = @('config.json', 'secrets.json')   # 本地配置，本来就不入库

# sk- 后面 24+ 个字母数字 = 像真 key；排除掉了占位符里的中文
$keyPattern = 'sk-[A-Za-z0-9]{24,}'
$allowPattern = 'testonly|fake|example|dummy|xxxx|placeholder|notarealkey'

$findings = @()

Get-ChildItem $Root -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length + 1)
    $top = ($rel -split '\\')[0]
    if ($skipDirs -contains $top) { return }
    if ($skipFiles -contains $_.Name) { return }
    # 只看文本类文件
    if ($_.Extension -notin @('.mjs', '.js', '.json', '.md', '.ps1', '.bat', '.cmd', '.txt', '.yml', '.yaml', '.example', '') -and $_.Name -notin @('.gitignore', '.gitattributes')) { return }

    $lineNo = 0
    foreach ($line in [System.IO.File]::ReadAllLines($_.FullName)) {
        $lineNo++
        if ($line -match $keyPattern) {
            if ($line -match $allowPattern) { continue }
            $findings += [pscustomobject]@{ File = $rel; Line = $lineNo; Text = $line.Trim() }
        }
    }
}

if ($findings.Count) {
    Write-Host ''
    Write-Host '[FAIL] 发现疑似真实密钥，已阻止打包/提交：' -ForegroundColor Red
    foreach ($f in $findings) {
        Write-Host ("  {0}:{1}" -f $f.File, $f.Line) -ForegroundColor Red
        Write-Host ("      {0}" -f $f.Text)
    }
    Write-Host ''
    Write-Host '  处理办法：把真 key 换成占位符（如 "sk-在这里填你的API密钥"），'
    Write-Host '            或让测试用的假 key 带上 testonly / fake 之类的字样。'
    Write-Host '            真 key 只应放在 secrets.json（已在 .gitignore 中）。'
    exit 1
}

if (-not $Quiet) { Write-Host '[ok] 密钥扫描通过：没有发现真实 key / token' }
exit 0
