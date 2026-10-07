param(
  [switch]$SkipOcrHealth,
  [switch]$RequireClean,
  [switch]$Publication
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $raw = & python -B tools/maintain-project.py test --all
  $testExit = $LASTEXITCODE
  if ($testExit -ne 0) { throw "Local verification failed: $($raw -join [Environment]::NewLine)" }
  $report = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
  if ($report.ok -ne $true -or $report.readiness -ne 'LOCAL_VERIFIED') {
    throw 'Local verification returned no valid proof'
  }
  if (-not $SkipOcrHealth) {
    $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:18766/health
    $body = $health.Content | ConvertFrom-Json
    if ($health.StatusCode -ne 200 -or $body.ok -ne $true -or $body.service -ne 'captcha-ocr') {
      throw 'OCR health check failed'
    }
  }
  $gitStatus = & git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git working tree' }
  $dirty = [bool]$gitStatus
  if ($RequireClean -and $dirty) {
    if ($Publication) { throw 'Publication requires a clean Git working tree' }
    throw 'working tree is not clean'
  }
  $commit = & git rev-parse --short HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve Git commit' }
  $state = Get-Content PROJECT_STATE.json -Raw -Encoding UTF8 | ConvertFrom-Json
  [pscustomobject]@{
    status = 'READY'
    verification = 'LOCAL_VERIFIED'
    version = $state.version
    commit = $commit
    elapsedSeconds = [math]::Round($report.elapsedMs / 1000, 3)
    suites = @($report.suites).Count
    workingTree = $(if ($dirty) { 'dirty' } else { 'clean' })
    runtimeVerification = 'not performed by local regression; use maintain-project.py status'
    runtimeRecorded = $state.tampermonkeyLoadedVersion
    githubHotUpdate = 'not checked by local regression; verify publication separately'
  } | ConvertTo-Json -Compress
} finally {
  Pop-Location
}
