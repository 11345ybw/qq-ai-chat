@echo off
REM dry run: connect QQ and think normally, but print instead of sending
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0scripts\resolve-node.bat"
if errorlevel 1 goto nonode
echo [qq-ai-chat] DRY RUN - nothing will actually be sent to QQ.
echo.
"%NODE_EXE%" "%~dp0src\index.mjs" --dry-run %*
echo.
pause
goto :eof

:nonode
echo [qq-ai-chat] Node.js not found. Run install-node.bat first.
pause
