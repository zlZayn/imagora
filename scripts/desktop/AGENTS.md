# scripts/desktop/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

scripts/desktop/ 特有约束：

- **exe 里写死了本目录 `.cmd` 的路径**（`launcher.cs` 的 `Path.Combine(root, "scripts", "desktop", …)`）。
  改这个常量或挪动 `.cmd`，必须重编根目录的 exe，否则双击直接失灵：
  `powershell -NoProfile -File scripts\desktop\make_launcher.ps1`
- **`.ico` 是编译期内嵌的**：换了图标不重编 exe，桌面看起来毫无变化。重编前先关掉正在运行的启动器窗口，
  Windows 不允许覆盖运行中的 exe（`make_launcher.ps1` 会先探测并把这句说成人话）。
- **`.cmd` 开头那行 `pushd "%~dp0..\.."` 不许动**：它把工作目录切回项目根，脚本里 `frontend\` 等相对路径全靠它。
  本目录深度变了就同步改上跳层数，别改成绝对路径。
- 图标产物与指纹（`.ico` / `icon-source.sha256`）**都不手改**：只由 `make_icon.py` 生成；
  二者与源图不同步时 `check_docs.py` 会红（按内容比指纹，不看 mtime——git 不保留时间）。
- 本机才能验的环节：CI 不双击 exe，所以"改完没坏"只能靠本机跑一遍（清单见 [README.md](README.md) 上方的变更影响路由与根 AGENTS「构建时机」）。
- 迁移逻辑与存储格式不在此目录（那是 `../migrate.py`，属硬边界）。
