param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository,
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_./-]*$')][string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-release.ps1 -RequireClean
  if ($LASTEXITCODE -ne 0) { throw 'Pre-publication verification failed; nothing was pushed' }
  $source = Get-Content .\jiangxi-radiation-auto-diagnose.user.js -Raw -Encoding UTF8
  if ($source -notmatch '@version\s+([^\s]+)') { throw 'Userscript version is missing' }
  $version = $Matches[1]
  $remote = "https://github.com/$Repository.git"
  $oldNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
  $PSNativeCommandUseErrorActionPreference = $false
  $probe = git ls-remote $remote 2>$null
  $PSNativeCommandUseErrorActionPreference = $oldNativeErrorPreference
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub repository is not reachable: $Repository"
  }
  git remote set-url origin $remote
  if ($LASTEXITCODE -ne 0) { throw 'Cannot configure Git remote' }
  git push origin "HEAD:$Branch"
  if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
  $raw = "https://raw.githubusercontent.com/$Repository/$Branch/jiangxi-radiation-auto-diagnose.user.js"
  $content = (Invoke-WebRequest -UseBasicParsing $raw).Content
  if ($content -notmatch '@version\s+([^\s]+)' -or $Matches[1] -ne $version) { throw 'Raw userscript version check failed' }
  Write-Output "published: $Repository/$Branch version=$version"
} finally {
  Pop-Location
}
