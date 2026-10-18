@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install the LTS version from https://nodejs.org and run start.bat again.
  pause
  exit /b 1
)
node run.js %*
set rc=%errorlevel%
if not "%rc%"=="0" pause
exit /b %rc%
