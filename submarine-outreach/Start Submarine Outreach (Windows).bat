@echo off
rem Double-click to start the Submarine Outreach portal on Windows. Keep this window open while you use it.
title Submarine Outreach
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo Opening nodejs.org - download the LTS version, install it, then double-click this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Please install the current LTS version from nodejs.org.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
if not exist node_modules (
  echo First start: installing - takes about a minute...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed - check your internet connection.
    pause
    exit /b 1
  )
)

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"
echo.
echo   Submarine Outreach is running at http://localhost:%PORT%
echo   Keep this window open while you work. Close it to stop.
echo   Emails are only sent and replies only checked while this is running.
echo.
call npm start
pause
