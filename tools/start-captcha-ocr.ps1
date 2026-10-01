param(
  [string]$Python = (Join-Path $PSScriptRoot '..\.captcha-ocr-venv\Scripts\python.exe'),
  [int]$Port = 18766
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'captcha_ocr_server.py'
$env:CAPTCHA_OCR_PORT = [string]$Port
& $Python $script
