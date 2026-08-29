@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
pushd "%~dp0" || exit /b 1

set "PORT=7860"
set "URL=http://127.0.0.1:%PORT%"
set "TMPFILE=%TEMP%\aig_http_%PORT%.txt"
set "SERVER_LOG=%TEMP%\aig_server_%PORT%.log"
set "BUILDSTATE=%TEMP%\aig_buildstate_%PORT%.txt"

REM ---- ANSI 彩色（24-bit 真彩色：成功绿 / 失败红 / 警告琥珀 / 信息蓝 / 次要灰；标签统一英文 [OK]/[ERROR]/[INFO]/[WARN]）----
set "ESC="
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "C_OK=%ESC%[38;2;22;163;74m"
set "C_ERR=%ESC%[38;2;220;38;38m"
set "C_INFO=%ESC%[38;2;37;99;235m"
set "C_WARN=%ESC%[38;2;217;119;6m"
set "C_DIM=%ESC%[38;2;107;114;128m"
set "C_RST=%ESC%[0m"

REM ============================================================
REM  [1/3] 前端构建状态检查：src 比 dist 新 -> 提示重建
REM ============================================================
powershell -NoProfile -Command "$f=Get-ChildItem 'frontend\src' -Recurse -File -EA SilentlyContinue; $t=$null; foreach($x in $f){if(-not $t -or $x.LastWriteTime -gt $t){$t=$x.LastWriteTime}}; if(-not (Test-Path 'frontend\dist\index.html')){'NOT_BUILT'}elseif($t -gt (Get-Item 'frontend\dist\index.html').LastWriteTime){'STALE'}else{'OK'}" > "%BUILDSTATE%" 2>nul
set /p BUILD_STATE=<"%BUILDSTATE%"

if "%BUILD_STATE%"=="NOT_BUILT" (
    echo %C_WARN%[WARN]%C_RST% 前端尚未构建（frontend\dist 缺失），首次使用需先构建
    set /p DOBUILD=%C_DIM%是否现在构建？^（输入 N 跳过，直接回车=是）：%C_RST%
    if /i not "!DOBUILD!"=="N" goto build_frontend
    goto check_running
)
if "%BUILD_STATE%"=="STALE" (
    echo %C_WARN%[WARN]%C_RST% 检测到前端源码更新，构建产物已过期
    set /p DOBUILD=%C_DIM%是否重新构建？^（输入 N 跳过，直接回车=是）：%C_RST%
    if /i not "!DOBUILD!"=="N" goto build_frontend
)

REM ============================================================
REM  [2/3] 服务状态检查：netstat 探测端口监听者，显示 PID
REM ============================================================
:check_running
set "SRV_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do set "SRV_PID=%%p"
if defined SRV_PID (
    echo %C_INFO%[INFO]%C_RST% 服务已在运行（PID !SRV_PID!），直接打开新窗口
    goto ready
)

echo %C_INFO%[INFO]%C_RST% 服务未运行，正在启动 ...

REM ---- 启动服务（同控制台启动：关闭本窗口即停止服务）----
start "" /b uv run python -m main ui --no-browser --port %PORT% > "%SERVER_LOG%" 2>&1

REM ---- 等待服务就绪（最长 30 秒）----
set /a TRIES=0
:wait
set /a TRIES+=1
if !TRIES! GTR 30 goto fail
timeout /t 1 /nobreak >nul
curl -s -o nul -w "%%{http_code}" "%URL%/api/config?win=1" > "%TMPFILE%" 2>nul
set /p CODE=<"%TMPFILE%"
if not "!CODE!"=="200" goto wait

set "SRV_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do set "SRV_PID=%%p"
if defined SRV_PID (
    echo %C_OK%[OK]%C_RST% 服务已就绪（PID !SRV_PID!）
) else (
    echo %C_WARN%[WARN]%C_RST% 服务已就绪，但未能识别进程 PID
)

REM ============================================================
REM  [3/3] 打开窗口，进入 rich 交互菜单
REM  （菜单内实时显示 PID / 窗口编号；Q 退出会停掉服务）
REM ============================================================
:ready
call :open_window
uv run python -m main menu --port %PORT%
exit /b 0

:build_frontend
echo %C_INFO%[INFO]%C_RST% 正在构建前端 ...
pushd frontend
call npm install >nul 2>&1
if errorlevel 1 (
    echo %C_ERR%[ERROR]%C_RST% npm install 失败。请手动执行: cd frontend ^&^& npm install
    popd
    goto check_running
)
call npm run build >nul 2>&1
if errorlevel 1 (
    echo %C_ERR%[ERROR]%C_RST% npm run build 失败。请手动执行: cd frontend ^&^& npm run build
    popd
    goto check_running
)
popd
echo %C_OK%[OK]%C_RST% 前端构建完成。
goto check_running

:open_window
for /f "tokens=2 delims=:,}" %%i in ('curl -s "%URL%/api/window/next"') do set "WIN=%%i"
if not defined WIN (
    echo %C_ERR%[ERROR]%C_RST% 无法获取窗口编号。
    pause
    exit /b 1
)
start "" "%URL%/?win=!WIN!"

REM ---- 首窗提示用该窗口主题色（与 frontend/src/accent.ts、main.py accent_for_window 同算法，
REM       统一实现见 scripts\window_accent.ps1，勿复制算法进本脚本）----
set "AIG_WIN=!WIN!"
set "ACCENT_PS=%~dp0scripts\window_accent.ps1"
for /f "tokens=1-3" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%ACCENT_PS%" -WindowId %AIG_WIN%') do (
    set "AR=%%a"
    set "AG=%%b"
    set "AB=%%c"
)
if not defined AR set "AR=166"
if not defined AG set "AG=48"
if not defined AB set "AB=48"
echo %C_OK%[OK]%C_RST% %ESC%[38;2;!AR!;!AG!;!AB!m已打开窗口 #!WIN!%ESC%[0m
exit /b 0

:fail
echo %C_ERR%[ERROR]%C_RST% 服务 30 秒内未就绪，请查看日志: %SERVER_LOG%
pause
exit /b 1
