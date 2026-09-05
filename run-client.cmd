@echo off
rem =========================================================
rem  DSH Desktop — quick launch from this folder.
rem  Uses the Electron runtime that setup.ps1 provisions under .\runtime\
rem  (or a running 'electron' on PATH). You normally don't run this directly
rem  after setup — use the Desktop / Start-Menu 'DSH Desktop' shortcut.
rem =========================================================
setlocal
cd /d "%~dp0"

set "ELEC=%~dp0runtime\electron-v33.4.11\electron.exe"
if not exist "%ELEC%" (
  rem look for any provisioned electron under runtime\
  for /f "delims=" %%e in ('dir /b /s /a-d "%~dp0runtime\electron.exe" 2^>nul') do set "ELEC=%%e"
)
rem fallback: electron on PATH (npm-installed dev electron)
if exist "%ELEC%" (
  start "" "%ELEC%" "%~dp0main.cjs"
) else (
  where electron >nul 2>nul && start "" electron "%~dp0main.cjs"
  if errorlevel 1 (
    echo [ERROR] Electron runtime not found. Run setup.cmd once first.
    pause
  )
)
endlocal
