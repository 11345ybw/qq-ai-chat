@echo off
REM start QQ + NapCat with the correct working directory
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-napcat.ps1" %*
pause
