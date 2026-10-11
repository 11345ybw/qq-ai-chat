@echo off
REM configure NapCat OneBot channels for this project (HTTP server + HTTP report)
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-napcat.ps1" %*
pause
