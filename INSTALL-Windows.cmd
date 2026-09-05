@echo off
rem =========================================================
rem  DSH Desktop - one-click install (Windows)
rem  Requires Node.js + global @deepseek-ai/dsh (see README),
rem  provisions Electron, makes Desktop + Start-Menu shortcut.
rem =========================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul || ( echo   Missing Node.js: install from https://nodejs.org & pause & exit /b 1 )
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 ( echo. & echo   Setup reported warnings/errors above. & pause & exit /b 1 )
echo.
echo   Done. Double-click 'DSH Desktop' on your Desktop to open DSH.
pause
endlocal
