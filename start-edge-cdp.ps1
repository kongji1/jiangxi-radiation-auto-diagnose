[CmdletBinding()]
param(
    [int]$Port = 9333,
    [string]$ProfileDir = 'C:\ctm-v\edge-cdp-manual-profile',
    [string]$OpenUrl = 'about:blank',
    [int]$WaitSeconds = 15
)

$ErrorActionPreference = 'Stop'

function Find-EdgeExecutable {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    if (-not $candidates) {
        throw 'Microsoft Edge executable was not found.'
    }
    # PowerShell unwraps a one-item array during assignment.  Indexing the
    # unwrapped string would return its first character (for example, `C`),
    # which makes Start-Process report that the executable cannot be found.
    return @($candidates)[0]
}

function Get-CdpVersion {
    param([string]$Uri)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
        if ($response.StatusCode -ne 200) { return $null }
        return ($response.Content | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

$versionUri = "http://127.0.0.1:$Port/json/version"
$existing = Get-CdpVersion -Uri $versionUri
if ($existing) {
    Write-Host "CDP is already running on port $Port."
    Write-Host "Browser: $($existing.Browser)"
    Write-Host "WebSocket: $($existing.webSocketDebuggerUrl)"
    exit 0
}

$edge = Find-EdgeExecutable
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

$arguments = @(
    "--user-data-dir=$ProfileDir",
    '--profile-directory=Default',
    "--remote-debugging-port=$Port",
    "--remote-allow-origins=http://127.0.0.1:$Port",
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    $OpenUrl
)

Write-Host "Starting an independent Edge CDP instance..."
Write-Host "Profile: $ProfileDir"
Write-Host "Port: $Port"
Start-Process -FilePath $edge -ArgumentList $arguments | Out-Null

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ready = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $ready = Get-CdpVersion -Uri $versionUri
    if ($ready) { break }
}

if (-not $ready) {
    throw "Edge started, but $versionUri did not respond within $WaitSeconds seconds. Check whether port $Port is already in use."
}

Write-Host "CDP is ready."
Write-Host "Browser: $($ready.Browser)"
Write-Host "WebSocket: $($ready.webSocketDebuggerUrl)"
Write-Host "Targets: http://127.0.0.1:$Port/json/list"
