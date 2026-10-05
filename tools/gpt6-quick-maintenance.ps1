param(
  [switch]$SkipOcrHealth,
  [switch]$RequireClean
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $started = Get-Date
  $state = Get-Content .\PROJECT_STATE.json -Raw -Encoding UTF8 | ConvertFrom-Json
  $source = Get-Content .\jiangxi-radiation-auto-diagnose.user.js -Raw -Encoding UTF8
  if ($source -notmatch '@version\s+([^\s]+)') { throw 'userscript version missing' }
  $version = $Matches[1]
  if ($version -ne $state.version) { throw "version mismatch: source=$version state=$($state.version)" }

  node --check .\jiangxi-radiation-auto-diagnose.user.js
  node .\tests\source-contract.test.mjs
  node .\tests\lifecycle-diagnostics.test.mjs
  node .\tests\release-failure.test.mjs
  if ($SkipOcrHealth) {
    python .\tests\captcha_ocr.test.py
  } else {
    python .\tests\captcha_ocr.test.py
  }
  $dirty = [bool](git status --porcelain)
  if ($RequireClean -and $dirty) { throw 'working tree is not clean' }

  $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  [pscustomobject]@{
    status = 'READY'
    version = $version
    commit = (git rev-parse --short HEAD)
    elapsedSeconds = $elapsed
    runtimeLoaded = $state.tampermonkeyLoadedVersion
    workingTree = $(if ($dirty) { 'dirty' } else { 'clean' })
    githubHotUpdate = 'pending repository and Raw verification'
  } | ConvertTo-Json -Compress
} finally {
  Pop-Location
}
