@echo off
REM pick a model provider interactively, then write it into config.json
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0scripts\resolve-node.bat"
if errorlevel 1 goto nonode
"%NODE_EXE%" "%~dp0src\index.mjs" --providers
echo.
set /p PROVIDER_ID=Enter provider id (glm / qwen / siliconflow ...), empty = cancel: 
if "%PROVIDER_ID%"=="" goto :eof
"%NODE_EXE%" "%~dp0src\index.mjs" --provider %PROVIDER_ID%
echo.
echo Now put your API key into secrets.json, then run check.bat
pause
goto :eof

:nonode
echo [qq-ai-chat] Node.js not found. Run install-node.bat first.
pause
