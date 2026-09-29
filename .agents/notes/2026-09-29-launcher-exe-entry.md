# 决策：桌面入口用自编译的启动器 exe（2026-09-29）

状态：生效

## 问题

入口要带上产品图标，但 Windows 不给 `.cmd` 嵌图标（系统限制）。[前一条决策](2026-09-28-launcher-icon-and-shortcut.md) 用 `.lnk` 快捷方式绕过了这点，落地当天（2026-09-28，提交 `1c2d27f`）就换成了 exe：`.lnk` 必须记录目标的**绝对路径**，换机器或换目录即失效，无法随仓库分发——只能各人本机自建，`.gitignore` 也已把 `*.lnk` 排除。

## 决策

`scripts/desktop/launcher.cs` 编译成根目录 `启动生图工作台.exe`，用户双击它，exe 只做转发：

- 以 `AppDomain.CurrentDomain.BaseDirectory` 为项目根，相对定位 `scripts/desktop/启动生图工作台.cmd`——仓库整体搬家或换机器都成立；
- `/win32icon:` 在编译期把 `scripts/desktop/启动生图工作台.ico` 嵌进 exe，图标因此出现在入口上；
- 交 `cmd.exe` 执行并透传退出码；`UseShellExecute = false` 继承本进程控制台，双击只出现一个窗口。

编译器用 Windows 自带的 `csc.exe`（.NET Framework 4.x），不引第三方依赖，做法见 [make_launcher.ps1](../../scripts/desktop/make_launcher.ps1)。

## 替代方案（强制）

- **`.lnk` 快捷方式**：前一条决策，同日放弃。图标能显示，但绝对路径写死、文件不入库，等于让每个人维护一个分发不出去的东西。
- **PyInstaller 等打包框架产 exe**：为一张图标引入整条构建链与打包依赖，改一次脚本就得重打一次，比 40 行 C# 重得多。
- **改注册表里 `.cmd` 的文件关联图标**：改的是全机器行为，副作用远超一个项目该碰的范围。
- **只做网页里的图标**：解决不了资源管理器里那个入口的样子。

## 影响

- **两处编译期烘焙**：`launcher.cs` 里的 `scripts/desktop/` 相对路径与 `.ico` 内容都进 exe。启动脚本再搬家、图标形状再改 → **必须重跑 `make_launcher.ps1`**，exe 不会自动跟着变。
- **CI 测不到这条链**：三路 CI 都不双击 exe，改坏了仍是绿的。本机验证顺序：重生成 ico → 关掉运行中的启动器 → `powershell -NoProfile -File scripts\desktop\make_launcher.ps1` → 双击看图标与菜单。
- **exe 被占用时编译失败**：csc 不能覆盖正在运行的 exe，`make_launcher.ps1` 先探测能否独占打开，把失败原因说清楚。
- 图标与品牌源图的同步由 [check_docs.py](../../scripts/check_docs.py) 按内容指纹把关；它判的是 `.ico` 产物，exe 内嵌的那一份要等重编译才更新。
