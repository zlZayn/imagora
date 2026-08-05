@echo off
pushd "%~dp0" || exit /b 1

echo Starting Image Tool UI ... http://127.0.0.1:7860
uv run python -m main ui

if errorlevel 1 (
    echo.
    echo [Image Tool] Failed - see output above.
    pause
)

exit /b %errorlevel%
