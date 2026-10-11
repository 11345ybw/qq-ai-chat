@echo off
REM make her send one message right now (to test the "proactive" path without waiting)
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0scripts\resolve-node.bat"
if errorlevel 1 goto nonode
"%NODE_EXE%" "%~dp0src\index.mjs" --once
echo.
pause
goto :eof

:nonode
echo [qq-ai-chat] Node.js not found. Run install-node.bat first.
pause
