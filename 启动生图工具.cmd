@echo off
setlocal enabledelayedexpansion
pushd "%~dp0" || exit /b 1

set "PORT=7860"
set "URL=http://127.0.0.1:%PORT%"
set "TMPFILE=%TEMP%\aig_http_%PORT%.txt"
set "PIDFILE=%TEMP%\aig_pid_%PORT%.txt"
set "SERVER_LOG=%TEMP%\aig_server_%PORT%.log"

REM ---- check if server already running ----
curl -s -o nul -w "%%{http_code}" "%URL%/api/config?win=1" > "%TMPFILE%" 2>nul
set /p CODE=<"%TMPFILE%"
if "%CODE%"=="200" (
    echo Service already running.
    del "%PIDFILE%" >nul 2>&1
    goto ready
)

echo Starting Imagora UI ... %URL%

REM ---- start server attached to THIS console: closing the window stops the service ----
start "" /b uv run python -m main ui --no-browser --port %PORT% > "%SERVER_LOG%" 2>&1

REM ---- wait for server ready (max 30s) ----
set /a TRIES=0
:wait
set /a TRIES+=1
if !TRIES! GTR 30 goto fail
timeout /t 1 /nobreak >nul
curl -s -o nul -w "%%{http_code}" "%URL%/api/config?win=1" > "%TMPFILE%" 2>nul
set /p CODE=<"%TMPFILE%"
if not "!CODE!"=="200" goto wait

REM ---- record server PID (for Q-quit path) ----
set "SRV_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do set "SRV_PID=%%p"
if not defined SRV_PID (
    echo [ERROR] Failed to detect server PID.
    pause
    exit /b 1
)
echo %SRV_PID%> "%PIDFILE%"

:ready
call :open_window

REM ---- rich interactive menu (N new window / Q quit) ----
uv run python -m main menu --port %PORT%
exit /b 0

:open_window
for /f "tokens=2 delims=:,}" %%i in ('curl -s "%URL%/api/window/next"') do set "WIN=%%i"
if not defined WIN (
    echo [ERROR] Cannot get a window number.
    pause
    exit /b 1
)
start "" "%URL%/?win=!WIN!"
exit /b 0

:fail
echo [ERROR] Server did not become ready in 30s. Check %SERVER_LOG%
pause
exit /b 1
