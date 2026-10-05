param(
  [string]$Python = (Join-Path $PSScriptRoot '..\.captcha-ocr-venv\Scripts\python.exe'),
  [int]$Port = 18766
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'captcha_ocr_server.py'
$healthUrl = "http://127.0.0.1:$Port/health"

# Avoid starting a second listener when another local service already owns the
# configured port.  Windows can allow two Python listeners with reuse-address
# semantics, which would make health/OCR requests nondeterministic.
try {
  $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $healthUrl
  if ($health.StatusCode -eq 200 -and $health.Content -match '"service"\s*:\s*"captcha-ocr"') {
    Write-Output "captcha OCR already healthy at $healthUrl"
    exit 0
  }
  throw "unexpected health response"
} catch {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    throw "Port $Port is already occupied by another service; choose a free port with -Port and set the matching OCR endpoint in the script settings."
  }
}

$env:CAPTCHA_OCR_PORT = [string]$Port
& $Python $script
