@echo off
REM install NapCat (shell) on this machine - see deploy\install-napcat.ps1
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-napcat.ps1" %*
pause
