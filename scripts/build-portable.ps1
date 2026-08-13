param(
  [string]$OutputRoot = "release"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path
$releaseRoot = Join-Path $projectRoot $OutputRoot
$packageRoot = Join-Path $releaseRoot "ImagoraPortable"
$runtimeRoot = Join-Path $packageRoot "runtime"

Write-Host "[1/5] 构建前端"
Push-Location (Join-Path $projectRoot "frontend")
npm install --silent
npm run build
Pop-Location

Write-Host "[2/5] 清理旧发布目录"
if (Test-Path $releaseRoot) { Remove-Item -LiteralPath $releaseRoot -Recurse -Force }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

Write-Host "[3/5] 打包后端运行时"
Push-Location $projectRoot
uv run --with pyinstaller pyinstaller --noconfirm --clean --onedir --name Imagora `
  --distpath (Join-Path $releaseRoot "pyinstaller-dist") `
  --workpath (Join-Path $releaseRoot "pyinstaller-work") `
  main.py
Pop-Location

Copy-Item -Path (Join-Path $releaseRoot "pyinstaller-dist\Imagora\*") -Destination $runtimeRoot -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot "Imagora.exe"))) {
  throw "PyInstaller 输出缺少 runtime\Imagora.exe，发布已终止。"
}
Remove-Item -LiteralPath (Join-Path $releaseRoot "pyinstaller-dist") -Recurse -Force
Remove-Item -LiteralPath (Join-Path $releaseRoot "pyinstaller-work") -Recurse -Force

Write-Host "[4/5] 复制前端与启动文件"
New-Item -ItemType Directory -Path (Join-Path $packageRoot "frontend") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "frontend\dist") -Destination (Join-Path $packageRoot "frontend") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "启动便携版.cmd") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot ".env.example") -Destination (Join-Path $packageRoot ".env.example") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination (Join-Path $packageRoot "README.md") -Force
New-Item -ItemType Directory -Path (Join-Path $packageRoot "output") -Force | Out-Null

Write-Host "[5/5] 生成压缩包"
$zipPath = Join-Path $releaseRoot "ImagoraPortable.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "发布包已生成：$zipPath"
Write-Host "首次使用：解压 -> 复制 .env.example 为 .env -> 填入 AIWANWU_API_KEY -> 双击 启动便携版.cmd"
