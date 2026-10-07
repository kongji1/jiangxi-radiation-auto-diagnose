@echo off
setlocal
python "%~dp0update_tampermonkey_radiation_cdp.py"
exit /b %errorlevel%
