@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
pushd "%~dp0" || exit /b 1

set "PORT=7860"
set "URL=http://127.0.0.1:%PORT%"
set "TMPFILE=%TEMP%\aig_http_%PORT%.txt"
set "PIDFILE=%TEMP%\aig_pid_%PORT%.txt"
set "SERVER_LOG=%TEMP%\aig_server_%PORT%.log"
set "BUILDSTATE=%TEMP%\aig_buildstate_%PORT%.txt"

REM ---- check frontend build state: src newer than dist -> rebuild hint ----
powershell -NoProfile -Command "$f=Get-ChildItem 'frontend\src' -Recurse -File -EA SilentlyContinue; $t=$null; foreach($x in $f){if(-not $t -or $x.LastWriteTime -gt $t){$t=$x.LastWriteTime}}; if(-not (Test-Path 'frontend\dist\index.html')){'NOT_BUILT'}elseif($t -gt (Get-Item 'frontend\dist\index.html').LastWriteTime){'STALE'}else{'OK'}" > "%BUILDSTATE%" 2>nul
set /p BUILD_STATE=<"%BUILDSTATE%"

if "%BUILD_STATE%"=="NOT_BUILT" (
    echo [WARN] 前端尚未构建 frontend\dist 缺失 首次使用需先构建
    set /p DOBUILD=Rebuild now? Y=yes / N=no, default Y:
    if /i not "!DOBUILD!"=="N" goto build_frontend
    goto check_running
)
if "%BUILD_STATE%"=="STALE" (
    echo [WARN] 检测到前端源码更新 dist 构建产物已过期
    set /p DOBUILD=Rebuild now? Y=yes / N=no, default Y:
    if /i not "!DOBUILD!"=="N" goto build_frontend
)
:check_running

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

:build_frontend
echo Building frontend ...
pushd frontend
call npm install >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm install failed. 请手动执行: cd frontend ^&^& npm install
    popd
    goto check_running
)
call npm run build >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm run build failed. 请手动执行: cd frontend ^&^& npm run build
    popd
    goto check_running
)
popd
echo [OK] 前端构建完成.
goto check_running

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
