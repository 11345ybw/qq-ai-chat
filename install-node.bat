@echo off
REM install a portable Node.js into .runtime\node (no admin required)
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-node.ps1" %*
pause
