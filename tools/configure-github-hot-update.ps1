param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[^/\s]+/[^/\s]+$')]
  [string]$Repository,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '..\jiangxi-radiation-auto-diagnose.user.js' | Resolve-Path
$source = Get-Content -Raw -LiteralPath $sourcePath
$update = "https://raw.githubusercontent.com/$Repository/$Branch/jiangxi-radiation-auto-diagnose.user.js"

$source = $source -replace '(?m)^// @updateURL\s+.*\r?\n', ''
$source = $source -replace '(?m)^// @downloadURL\s+.*\r?\n', ''
$needle = '// @version      '
$lineEnd = $source.IndexOf("`n", $source.IndexOf($needle))
if ($lineEnd -lt 0) { throw '无法定位 userscript 元数据版本行' }
$source = $source.Insert($lineEnd + 1, "// @updateURL   $update`r`n// @downloadURL $update`r`n")
Set-Content -LiteralPath $sourcePath -Value $source -Encoding utf8 -NoNewline

Write-Output "已写入 GitHub 热更新地址：$update"
Write-Output '下一步：递增 @version，运行 node tests/source-contract.test.mjs，再推送到目标仓库。'
