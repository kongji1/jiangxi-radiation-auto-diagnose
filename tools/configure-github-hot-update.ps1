param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[^/\s]+/[^/\s]+$')]
  [string]$Repository,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
# The Node helper writes the raw.githubusercontent.com @updateURL/@downloadURL metadata.
$node = Get-Command node -ErrorAction Stop
$helper = Join-Path $PSScriptRoot 'configure-github-hot-update.mjs'
& $node.Source $helper --repository $Repository --branch $Branch
if ($LASTEXITCODE -ne 0) { throw "Hot-update helper failed with exit code $LASTEXITCODE" }
