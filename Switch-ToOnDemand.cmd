@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Switching the local helper to on-demand startup...
echo.
call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -OnDemand
set "RESULT=%ERRORLEVEL%"

echo.
if not "%RESULT%"=="0" (
    echo Switch did not complete. Error code: %RESULT%
) else (
    echo Switched to on-demand startup.
)
echo.
pause
exit /b %RESULT%