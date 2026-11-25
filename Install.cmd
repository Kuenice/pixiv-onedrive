@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Installing Pixiv -> OneDrive helper and Edge extension...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "RESULT=%ERRORLEVEL%"

echo.
if not "%RESULT%"=="0" (
    echo Installation did not complete. Error code: %RESULT%
) else (
    echo Installation finished.
)
echo.
pause
exit /b %RESULT%
