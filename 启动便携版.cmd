@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0" || exit /b 1

set "PORT=7860"
set "APP=%~dp0runtime\Imagora.exe"
set "URL=http://127.0.0.1:%PORT%"
if not exist "%APP%" (
  echo [ERROR] 未找到 runtime\Imagora.exe，请使用 scripts\build-portable.ps1 构建发布包。
  pause
  exit /b 1
)

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do set "SRV_PID=%%p"
if not defined SRV_PID (
  echo [INFO] 正在启动 Imagora ...
  start "" /b "%APP%" ui --no-browser > "%TEMP%\imagora_portable_%PORT%.log" 2>&1
  set /a TRIES=0
:wait
  set /a TRIES+=1
  if %TRIES% GTR 30 goto fail
  timeout /t 1 /nobreak >nul
  powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing '%URL%/api/config?win=1').StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
  if errorlevel 1 goto wait
)

start "" "%URL%/?win=1"
"%APP%" menu --port %PORT%
exit /b 0

:fail
echo [ERROR] 服务 30 秒内未就绪，请查看 %TEMP%\imagora_portable_%PORT%.log
pause
exit /b 1
