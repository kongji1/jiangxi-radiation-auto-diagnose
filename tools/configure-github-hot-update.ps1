param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[^/\s]+/[^/\s]+$')]
  [string]$Repository,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$sourcePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\jiangxi-radiation-auto-diagnose.user.js'))
$utf8 = New-Object System.Text.UTF8Encoding($false)
# Windows PowerShell 5 的 Get-Content/Set-Content 默认编码会破坏中文 userscript；
# 明确使用 UTF-8（无 BOM）读写，保证热更新配置不会改变脚本内容。
$source = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8
if ([string]::IsNullOrEmpty($source)) { throw 'Unable to read userscript as UTF-8; refusing to overwrite the source file' }
$update = "https://raw.githubusercontent.com/$Repository/$Branch/jiangxi-radiation-auto-diagnose.user.js"

$updateLine = "// @updateURL   $update"
$downloadLine = "// @downloadURL $update"
$source = $source -replace '(?m)^// @updateURL[^\r\n]*$', $updateLine
$source = $source -replace '(?m)^// @downloadURL[^\r\n]*$', $downloadLine
[System.IO.File]::WriteAllText($sourcePath, $source, $utf8)

Write-Output "GitHub hot-update URL configured: $update"
Write-Output 'Next: increment @version, run node tests/source-contract.test.mjs, then push to the repository.'
