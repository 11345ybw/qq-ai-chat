@echo off
REM remove the QQAIChat scheduled task
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t='QQAIChat'; if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $t -Confirm:$false; Write-Host 'Task removed.' } else { Write-Host 'Task not installed.' }"
pause
