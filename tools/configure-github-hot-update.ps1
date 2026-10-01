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
if ($lineEnd -lt 0) { throw 'Unable to locate userscript version metadata' }
$source = $source.Insert($lineEnd + 1, "// @updateURL   $update`r`n// @downloadURL $update`r`n")
Set-Content -LiteralPath $sourcePath -Value $source -Encoding utf8 -NoNewline

Write-Output "GitHub hot-update URL configured: $update"
Write-Output 'Next: increment @version, run node tests/source-contract.test.mjs, then push to the repository.'
