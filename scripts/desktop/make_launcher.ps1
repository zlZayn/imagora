# 编译项目根目录的「启动生图工作台.exe」——一个把 scripts\desktop\启动生图工作台.cmd
# 转交给 cmd 的极简启动器（源码同目录 launcher.cs）。
#
# 用 Windows 自带的 C# 编译器（.NET Framework 4.x 的 csc.exe），不引入任何第三方依赖；
# exe 内嵌 scripts\desktop\启动生图工作台.ico 作为图标，并按自身所在目录定位脚本，
# 因此可以随仓库分发、换目录或换机器都能用。
#
# 何时需要重跑：
#   - 改了 launcher.cs（启动器行为）
#   - 换了图标（.ico 是编译期内嵌的）
# 何时**不需要**：
#   - 改 scripts\desktop\启动生图工作台.cmd 的逻辑（exe 只是转发，不解析其内容）
#   - 改前端 / 后端代码（那是 npm run build 的事，见 frontend/README.md）
#
# 用法（项目根目录）：powershell -NoProfile -File scripts\desktop\make_launcher.ps1
# 可选 -Output 指定输出路径以做试验，不覆盖正式文件。

[CmdletBinding()]
param(
    [string]$Output
)

$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
$root = Split-Path -Parent (Split-Path -Parent $scriptDir)
$source = Join-Path $scriptDir 'launcher.cs'
$icon = Join-Path $scriptDir '启动生图工作台.ico'
$target = if ($Output) { $Output } else { Join-Path $root '启动生图工作台.exe' }

foreach ($path in @($source, $icon)) {
    if (-not (Test-Path $path)) { throw "缺少输入文件：$path" }
}

$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) {
    throw '未找到 csc.exe（需要 .NET Framework 4.x；Win10/11 系统自带）'
}

# 目标 exe 若正在运行，Windows 不允许覆盖它，csc 只会给出一个看不出原因的失败。
# 先探一下能不能独占打开，把话说清楚。
if (Test-Path $target) {
    try {
        $probe = [System.IO.File]::Open($target, 'Open', 'ReadWrite', 'None')
        $probe.Close()
    }
    catch {
        throw "目标文件正被占用：$target`n→ 请先关闭正在运行的启动器窗口（或结束「启动生图工作台」进程）后重试。"
    }
}

# /codepage:65001 让编译器按 UTF-8 读源码（源码含中文提示语）
& $csc /nologo /target:exe /platform:anycpu /codepage:65001 `
    "/win32icon:$icon" "/out:$target" $source

if ($LASTEXITCODE -ne 0) { throw "编译失败：csc 退出码 $LASTEXITCODE" }

$size = (Get-Item $target).Length
Write-Host "[OK] 已生成 $target（$size 字节，图标已内嵌）" -ForegroundColor Green
