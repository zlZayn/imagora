@echo off
chcp 65001 >nul
pushd "%~dp0" || exit /b 1

if not exist ".env" (
    echo [警告] 未找到 .env，API Key 未配置，生成图片会失败。
    echo        首次使用请复制 .env.example 为 .env 并填入 AIWANWU_API_KEY=sk-...
)

if not exist "frontend\dist\index.html" (
    echo [信息] 首次运行，构建前端 ...
    pushd frontend
    call npm install || (popd & pause & exit /b 1)
    call npm run build || (popd & pause & exit /b 1)
    popd
)

echo.
echo 启动 A站生图工具 ...  http://127.0.0.1:7860
uv run python -m main ui

if errorlevel 1 (
    echo.
    echo [错误] 启动失败，见上方输出。
    pause
)

exit /b %errorlevel%
