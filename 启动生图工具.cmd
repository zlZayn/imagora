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
    echo Server already running - it will NOT be stopped on Quit.
    goto ready
)

echo Starting Image Tool UI (hidden background) ... %URL%

REM ---- start server hidden, record its PID ----
powershell -NoProfile -ExecutionPolicy Bypass -Command "$uv=(Get-Command uv).Source; $p=Start-Process -FilePath $uv -ArgumentList @('run','python','-m','main','ui','--no-browser','--port','%PORT%') -WorkingDirectory '%~dp0' -WindowStyle Hidden -RedirectStandardError '%SERVER_LOG%' -PassThru; [System.IO.File]::WriteAllText('%PIDFILE%', [string]$p.Id)"
set /p SRV_PID=<"%PIDFILE%"
if not defined SRV_PID (
    echo [ERROR] Failed to start server process.
    pause
    exit /b 1
)

REM ---- wait for server ready (max 30s) ----
set /a TRIES=0
:wait
set /a TRIES+=1
if !TRIES! GTR 30 goto fail
timeout /t 1 /nobreak >nul
curl -s -o nul -w "%%{http_code}" "%URL%/api/config?win=1" > "%TMPFILE%" 2>nul
set /p CODE=<"%TMPFILE%"
if not "!CODE!"=="200" goto wait

:ready
echo Server ready.
call :open_window

echo.
echo ============================================================
echo   Image Tool  -  %URL%
echo   [N] Open a new window (auto numbered)
echo   [Q] Quit  (stop the server)
echo ============================================================
:menu
choice /c NQ /n /m "Select [N]ew-window / [Q]uit: "
if errorlevel 2 goto quit
call :open_window
goto menu

:open_window
for /f "tokens=2 delims=:,}" %%i in ('curl -s "%URL%/api/window/next"') do set "WIN=%%i"
if not defined WIN (
    echo [ERROR] Cannot get a window number from %URL%.
    pause
    exit /b 1
)
start "" "%URL%/?win=!WIN!"
echo Opened window #!WIN!
exit /b 0

:fail
echo [ERROR] Server did not become ready in 30 seconds. Check %SERVER_LOG%
pause
exit /b 1

:quit
if defined SRV_PID (
    taskkill /pid %SRV_PID% /f /t >nul 2>&1
    echo Server stopped. Bye.
) else (
    echo Quit. Existing server left running.
)
exit /b 0
