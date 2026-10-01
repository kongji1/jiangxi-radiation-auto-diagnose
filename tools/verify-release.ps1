param(
  [switch]$SkipOcrHealth,
  [switch]$RequireClean
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  node --check .\jiangxi-radiation-auto-diagnose.user.js
  if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed' }
  node .\tests\source-contract.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Source contract check failed' }
  python .\tests\captcha_ocr.test.py
  if ($LASTEXITCODE -ne 0) { throw 'OCR tests failed' }
  if (-not $SkipOcrHealth) {
    $health = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18766/health
    if ($health.StatusCode -ne 200 -or $health.Content -notmatch '"ok"\s*:\s*true') {
      throw 'OCR health check failed'
    }
    Write-Output "ocr-health: $($health.Content)"
  }
  $dirty = git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git working tree' }
  if ($dirty) {
    if ($RequireClean) { throw 'Publication requires a clean Git working tree' }
    Write-Output 'release-check: source checks passed; working tree has uncommitted changes'
    $dirty | Write-Output
  } else {
    Write-Output 'release-check: source checks passed; working tree clean'
  }
} finally {
  Pop-Location
}
