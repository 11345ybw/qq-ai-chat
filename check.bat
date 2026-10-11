@echo off
REM self-check: model API + QQ (OneBot) connection
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0scripts\resolve-node.bat"
if errorlevel 1 goto nonode
echo [qq-ai-chat] running self-check (this really calls your model API once)...
echo.
"%NODE_EXE%" "%~dp0src\index.mjs" --check
echo.
pause
goto :eof

:nonode
echo [qq-ai-chat] Node.js not found. Run install-node.bat first.
pause
