param(
  [Parameter(Mandatory = $true)][string]$Repository,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-release.ps1
  $remote = "https://github.com/$Repository.git"
  $probe = git ls-remote $remote 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub repository is not reachable: $Repository"
  }
  git remote set-url origin $remote
  git push origin "HEAD:$Branch"
  if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
  $raw = "https://raw.githubusercontent.com/$Repository/$Branch/jiangxi-radiation-auto-diagnose.user.js"
  $content = (Invoke-WebRequest -UseBasicParsing $raw).Content
  if ($content -notmatch '@version\s+0\.8\.21') { throw 'Raw userscript version check failed' }
  Write-Output "published: $Repository/$Branch version=0.8.21"
} finally {
  Pop-Location
}
