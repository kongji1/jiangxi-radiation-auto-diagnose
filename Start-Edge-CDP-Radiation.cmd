@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-edge-cdp.ps1" -Port 9333 -OpenUrl "http://10.10.94.90:22112/radiation"
if errorlevel 1 pause
