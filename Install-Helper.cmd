@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Installing PixivOneDriveHelper only (for the Edge Add-ons version)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -HelperOnly
set "RESULT=%ERRORLEVEL%"

echo.
if not "%RESULT%"=="0" (
    echo Installation did not complete. Error code: %RESULT%
) else (
    echo Helper installation finished.
)
echo.
pause
exit /b %RESULT%
