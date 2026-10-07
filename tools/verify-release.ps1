param(
  [switch]$SkipOcrHealth,
  [switch]$RequireClean
)

$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/invoke-local-verification.ps1" -SkipOcrHealth:$SkipOcrHealth -RequireClean:$RequireClean -Publication
