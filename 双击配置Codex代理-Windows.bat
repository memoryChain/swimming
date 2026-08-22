@echo off
chcp 65001 >nul
setlocal

pushd "%~dp0"

echo Configuring Codex system proxy support...
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js or the project development environment, then run this file again.
  echo.
  pause
  popd
  exit /b 1
)

node.exe "scripts\setup-codex-system-proxy.mjs"
set "SETUP_EXIT_CODE=%ERRORLEVEL%"

echo.
if "%SETUP_EXIT_CODE%"=="0" (
  echo [SUCCESS] Setup completed. Fully quit and reopen Codex.
) else (
  echo [ERROR] Setup failed. Send the contents of this window to the maintainer.
)
echo.
pause
popd
exit /b %SETUP_EXIT_CODE%
