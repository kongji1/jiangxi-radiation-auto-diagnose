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
  node .\tests\auto-entry-schedule.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Auto-entry schedule tests failed' }
  node .\tests\developer-retention.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Developer retention tests failed' }
  node .\tests\report-entry-observer.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Report entry observer tests failed' }
  node .\tests\configuration-persistence.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Configuration persistence tests failed' }
  node .\tests\final-entry-pending.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Final entry pending tests failed' }
  node .\tests\locked-entry-hard-gate.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Locked entry hard gate tests failed' }
  node .\tests\request-preparation.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Request preparation tests failed' }
  node .\tests\automatic-entry-once.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Automatic entry once tests failed' }
  node .\tests\report-record-resolution.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Report record resolution tests failed' }
  node .\tests\exam-exclusions.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Exam exclusion tests failed' }
  node .\tests\realtime-queue.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Realtime queue tests failed' }
  node .\tests\protocol-entry-handoff.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Protocol entry handoff tests failed' }
  node .\tests\protocol-final-entry.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Protocol final entry tests failed' }
  node .\tests\direct-login.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Direct login tests failed' }
  node .\tests\lifecycle-diagnostics.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lifecycle diagnostics check failed' }
  node .\tests\release-failure.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Release failure tests failed' }
  python .\tests\captcha_ocr.test.py
  if ($LASTEXITCODE -ne 0) { throw 'OCR tests failed' }
  python -B .\tests\runtime-verifier.test.py
  if ($LASTEXITCODE -ne 0) { throw 'Runtime verifier tests failed' }
  if (-not $SkipOcrHealth) {
    $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:18766/health
    $healthBody = $health.Content | ConvertFrom-Json
    if ($health.StatusCode -ne 200 -or $healthBody.ok -ne $true -or $healthBody.service -ne 'captcha-ocr') {
      throw 'OCR health check failed'
    }
    Write-Output "ocr-health: $($health.Content)"
  }
  git diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Git diff check failed' }
  git diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw 'Git staged diff check failed' }
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
