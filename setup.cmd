@echo off
rem =========================================================
rem  DSH Desktop — 一键安装 (Windows)
rem  运行 setup.ps1；若脚本策略限制则用 Bypass。
rem =========================================================
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup finished with warnings/errors above.
  pause
)
endlocal
