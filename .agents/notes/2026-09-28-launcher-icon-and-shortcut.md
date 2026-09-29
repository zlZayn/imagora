# 决策：启动入口的图标绑定方案（2026-09-28）

状态：被取代

指针：[决策：桌面入口用自编译的启动器 exe（2026-09-29）](2026-09-29-launcher-exe-entry.md)

## 问题

根目录 `启动生图工作台.cmd` 是双击入口，但资源管理器里显示的是 cmd 默认图标，与产品无关。
Windows **不支持给 `.cmd` / `.bat` 嵌图标**（这是系统限制，不是配置问题），所以「图标出现在入口上」必须借外部机制实现。
约束：稳、兼容优先、少依赖、少折腾，且项目路径日后可能变动。

## 决策

用 **Windows 快捷方式**：根目录只放 `启动生图工作台.lnk`，指向 `scripts/desktop/启动生图工作台.cmd`，`IconLocation` 指向 `scripts/desktop/启动生图工作台.ico`——根目录因此只出现一个入口。

- 启动脚本与图标都收在 `scripts/desktop/`：脚本用 `pushd "%~dp0..\.."` 把工作目录切回项目根，`frontend/` 等相对路径才成立（约束见 [scripts/AGENTS.md](../../scripts/AGENTS.md)）。
- 入口图标由 [make_icon.py](../../scripts/desktop/make_icon.py) 从 `frontend/src/brand/logo.svg` 生成。
- 图标为**透明底 + 灰黑线条**（`#17202b`，项目正文文字色），取代原先「紫色渐变方块 + 白线」的通用 AI 观感。
- `.cmd` 原文件零改动——快捷方式只是并列新增的一个文件。

## 替代方案（强制）

- **打包 exe 嵌图标**（PyInstaller 等）：需要引入打包依赖、维护构建链，且每次改脚本都要重新打包；对「双击一个本地脚本」而言是完全不成比例的复杂度。
- **自写启动器 exe**：为一张图标造一个可执行文件，还要自行处理参数透传、控制台窗口、被杀软误报；违反「能用系统原生机制就别造轮子」。
- **把 `.cmd` 改名成 `.exe`**：不可行，扩展名决定解释方式，改名后无法执行。
- **只改注册表里 `.cmd` 的文件关联图标**：会影响**全机器所有** `.cmd` 文件，属于改系统行为，副作用远超收益。
- **给整个文件夹设自定义图标**：只能改文件夹自身观感，用户仍会去双击里面的 `.cmd`，没解决入口问题。

## 影响

- **路径变动后需重建快捷方式**（`.lnk` 记录的是绝对路径；同目录关系可让 Shell 兜底，但不保证）。重建就一条命令：

  ```powershell
  $root = (Get-Location).Path
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut("$root\启动生图工作台.lnk")
  $s.TargetPath = "$root\scripts\desktop\启动生图工作台.cmd"
  $s.WorkingDirectory = $root
  $s.IconLocation = "$root\scripts\desktop\启动生图工作台.ico,0"
  $s.Save()
  ```

- **任务栏图标仍是默认的**：`.lnk` 只决定「入口在资源管理器里的样子」。运行中窗口/任务栏图标由宿主进程（`cmd.exe` → `python.exe`）决定，要换需走 exe 路线，当前不做。
- 回退：删掉 `启动生图工作台.lnk` 即回到原状；`.ico` 的旧版本可从 git 取回（`git checkout -- scripts/desktop/启动生图工作台.ico`）。
