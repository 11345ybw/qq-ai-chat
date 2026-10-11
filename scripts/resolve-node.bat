@echo off
REM locate a usable node.exe: portable one installed by install-node.ps1 first, then PATH
REM NOTE: %~dp0 here is the scripts\ folder, so the project root is its parent.
REM ASCII only - see start.bat for why.
set "NODE_EXE="
for %%i in ("%~dp0..") do set "ROOT=%%~fi"
if exist "%ROOT%\.runtime\node\node.exe" set "NODE_EXE=%ROOT%\.runtime\node\node.exe"
if not defined NODE_EXE (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%i"
  )
)
if not defined NODE_EXE exit /b 1
exit /b 0
