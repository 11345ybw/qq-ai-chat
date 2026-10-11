@echo off
REM register a scheduled task so the bot starts when you log into Windows
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" %*
pause
