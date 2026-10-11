@echo off
REM stop the running bot (only kills node processes whose command line points at this project)
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-bot.ps1"
pause
