@echo off
pushd "%~dp0" || exit /b 1

if not exist "frontend\dist\index.html" (
    echo [Image Tool] Frontend not built. Building now ...
    pushd frontend
    call npm install || exit /b 1
    call npm run build || exit /b 1
    popd
)

echo Starting Image Tool UI ... http://127.0.0.1:7860
uv run python -m main ui

if errorlevel 1 (
    echo.
    echo [Image Tool] Failed - see output above.
    pause
)

exit /b %errorlevel%
