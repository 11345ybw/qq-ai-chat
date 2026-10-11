@echo off
REM NOTE: keep this file ASCII-only. cmd.exe on Chinese Windows reads .bat as GBK,
REM so non-ASCII characters here get mangled and can break batch parsing.
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0scripts\resolve-node.bat"
if errorlevel 1 goto nonode
echo [qq-ai-chat] starting... (close this window to stop)
echo.
"%NODE_EXE%" "%~dp0src\index.mjs" %*
echo.
echo [qq-ai-chat] exited with code %ERRORLEVEL%
pause
goto :eof

:nonode
echo.
echo [qq-ai-chat] Node.js not found.
echo   1) run install-node.bat first (installs a portable Node, no admin needed), or
echo   2) install Node 20 LTS from https://nodejs.org and reopen this window.
echo.
pause
