@echo off
REM Start the HBS weekly scoreboard and open it in a browser.
REM Double-click this file; leave the window open while you use the dashboard.
cd /d "%~dp0"

set "DB=data\scoreboard.sqlite"
if not exist "%DB%" set "DB=data\demo.sqlite"
if not exist "%DB%" (
  echo No data cache found. Loading the sample first...
  py scripts\load_sample.py data\demo.sqlite || goto :failed
  set "DB=data\demo.sqlite"
)

REM Give the server a moment to bind before the browser asks for the page.
start "" /b cmd /c "timeout /t 4 /nobreak >nul && start "" http://127.0.0.1:8000"

py -m hbs_scoreboard.cli --db "%DB%" serve
if errorlevel 1 goto :failed

echo.
echo Server stopped.
pause >nul
exit /b 0

:failed
echo.
echo The scoreboard could not start. The error is above.
pause >nul
exit /b 1
