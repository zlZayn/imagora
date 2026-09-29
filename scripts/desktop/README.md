# scripts/desktop/ — 桌面入口与图标链

Windows 桌面侧的全部东西在这：用户实际跑的启动脚本、做图标的脚本、编译 exe 的脚本，以及它们的输入与产物。
`scripts/` 根下只剩跨领域运维脚本（`check_docs.py` / `migrate.py`）。

整条链：`frontend/src/brand/logo.svg` →（`make_icon.py`）→ `启动生图工作台.ico` →（`make_launcher.ps1` 内嵌）→ 根目录 `启动生图工作台.exe` →（转交）→ `启动生图工作台.cmd`。

## 文件索引

| 文件 | 职责 | 危险级别 |
| --- | --- | --- |
| [启动生图工作台.cmd](启动生图工作台.cmd) | **实际启动脚本**：检查前端构建状态 → 探测或起 7860 服务 → 开窗 → 进彩色交互菜单（`N` 开下一窗、`Q` 或关窗连根停服务）。关服务靠 `taskkill` 回溯祖先链，属进程操作 | 中（会起/停进程，不写项目文件） |
| [window_accent.ps1](window_accent.ps1) | 首窗终端配色的 RGB 计算（黄金角 137.508 / HSL 55%,42% → 输出 "R G B"，终端 24-bit ANSI）。**与 `frontend/src/accent.ts`、`main.py:accent_for_window` 三处同源**，改配色必须三处同改 | 低（只读计算） |
| [launcher.cs](launcher.cs) | 启动器源码：只做一件事——把本目录的 `.cmd` 交给 `cmd.exe` 并透传退出码。**exe 里写死了那条路径**，改常量或挪 `.cmd` 就得重编 exe | 低（源码） |
| [make_launcher.ps1](make_launcher.ps1) | 用系统自带 `csc.exe`（.NET Framework 4.x，无第三方依赖）编译成根目录 `启动生图工作台.exe` 并内嵌图标；目标被占用时先探测再报人话 | 中（覆盖根目录 exe） |
| [make_icon.py](make_icon.py) | 由品牌源图渲染并打包 ICO（`getBBox()` 紧致取景、逐尺寸浏览器渲染、标准库按 ICO 规范嵌 PNG，16/24/32/48/64/128/256）；同时写源图指纹 | 低（只写本目录两文件，不动源图） |
| [启动生图工作台.ico](启动生图工作台.ico) | exe 的图标，**编译期内嵌的产物**，不手写 | — |
| [icon-source.sha256](icon-source.sha256) | 生成 ICO 那一刻源图的内容指纹，供 `../check_docs.py` 校验 | — |

## 命令（都在项目根目录跑）

```powershell
.\.venv\Scripts\python.exe scripts\desktop\make_icon.py                       # 重做图标 + 刷新指纹
powershell -NoProfile -File scripts\desktop\make_launcher.ps1                 # 重编根目录 exe（先关启动器窗口）
powershell -NoProfile -File scripts\desktop\window_accent.ps1 -WindowId 1     # 单验配色
```

`make_icon.py` 可传输出路径做预览（不覆盖正式文件）。入口图标为何用 exe 转交而不是快捷方式，见
[决策记录](../../.agents/notes/2026-09-28-launcher-icon-and-shortcut.md)。

## 改后验证

- 改了图标链：`python -c` 用 Pillow 读回 ICO 的 `sizes` 与 alpha 极值，再看资源管理器里 exe 的观感；
  然后**双击 exe** 走一遍（菜单出来、`N` 开新窗、`Q` 收尾）。
- 改了配色算法：上面那条 `window_accent.ps1` 的输出对照 `python -c "import main; print(main.accent_for_window(1))"` 的 `#rrggbb`。
- 改了 `.cmd` 的菜单或收尾：先停掉 7860 服务，再双击根目录 `启动生图工作台.exe`，应在数秒内就绪并自动开窗。

## 被谁依赖 / 变更影响路由

- 根目录 `启动生图工作台.exe` 与（本机的）快捷方式指向本目录的 `.cmd`；`.cmd` 开头 `pushd "%~dp0..\.."` 是全部相对路径的基准。
- 改启动流程或进程收尾 → 同步 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 3.2 / 3.3。
- 改图标或 `launcher.cs` → 必须重编 exe，命令见上；没重编就红不了 CI，只能本机发现。
- 目录约束与不许动的东西 → 见 [AGENTS.md](AGENTS.md)。
