# scripts/ — 运维脚本（启动入口 / 迁移 / 校验 / 图标）

**危险等级：迁移脚本是破坏性操作，`--apply` 前必须 dry-run + 人工确认（Handoff 硬边界：改迁移逻辑/存储格式必须维护者确认）。**

## 文件索引

### [启动生图工作台.cmd](启动生图工作台.cmd)
- 职责：**项目双击入口的实际脚本**（根目录 `启动生图工作台.lnk` 指向它）——检查前端构建状态 → 探测或启动 7860 服务 → 打开浏览器窗口 → 进入 `main menu` 交互菜单；关闭窗口即停服务
- 危险级别：低（只读状态 + 起服务，不写项目文件）
- 依赖：同目录 [`window_accent.ps1`](window_accent.ps1)（首窗终端配色）、同目录 [`启动生图工作台.ico`](启动生图工作台.ico)（入口图标，由 [make_icon.py](make_icon.py) 生成）
- 注意：脚本用 `pushd "%~dp0.."` 把工作目录切到项目根，`frontend/`、`main.py` 等相对路径全依赖这一行——移动本脚本时别动它
- 改后验证：先停掉 7860 服务，再双击根目录快捷方式，应在数秒内就绪并自动开窗

### [window_accent.ps1](window_accent.ps1)
- 职责：窗口主题色 RGB 计算（黄金角 137.508 / HSL 55%,42% → 输出 "R G B"）——**与 `frontend/src/accent.ts`、`main.py:accent_for_window` 同一算法的 PowerShell 实现**，供启动脚本首窗提示按该窗口主题色着色（终端 24-bit ANSI）
- 被谁依赖：同目录 [`启动生图工作台.cmd`](启动生图工作台.cmd)（`powershell -File window_accent.ps1 -WindowId N`）
- 危险级别：低（只读计算，不写文件）
- 注意：**算法三处同源**（accent.ts / main.py / 本脚本），改色相/饱和/明度必须三处同步，勿单独改动；命令串含括号不便嵌入 cmd 的 for /f，故抽成独立脚本
- 改后验证：`powershell -File scripts\window_accent.ps1 -WindowId 1` 对照 `python -c "import main; print(main.accent_for_window(1))"` 的 #rrggbb

### [check_docs.py](check_docs.py)
- 职责：仓库完整性只读校验——相对 markdown 链接可解析 + 仪表盘测试计数与源码一致（后端数 `def test_`、前端数 `it()`，逐处比对 AGENTS / tests/README / ARCHITECTURE / frontend/README 的声明数字）+ 桌面图标产物与品牌源图同步（比 `icon-source.sha256`）
- 危险级别：**低**（只读，不写任何文件）
- 命令：`python scripts/check_docs.py`（`--quiet` 只出问题）；退出码 0=通过 / 1=有断链或计数漂移
- 落点：已接进 CI —— [.github/workflows/ci.yml](../.github/workflows/ci.yml) 前端 job 的第一步（checkout 之后、`npm ci` 之前，不装依赖所以判红快），CI 上写作 `python3`（ubuntu runner），本地仍是 `python`
- 改后必测：`python scripts/check_docs.py` 自检（改文档后跑一次即可，无需单测——脚本本身即校验器）
- 注意它有两处**已知盲区**（2026-09-29 实测，别把"绿"当成"表格全对"）：
  - 前端**逐文件**用例数不校验（表格行只 `pass`），总数按 `frontend/src` 全量 `it()` 数——曾出现四处逐文件数字与源码不符而脚本仍绿
  - 只解析 markdown 链接 `[..](..)`，写在反引号里的路径（如 `` `docs/x.md` ``）照不到
- 背景：计数分散多处人工同步易漏（曾出现 221→222 漏改、frontend 145 过时数字），脚本把「数字与源码一致」从纪律变成可执行检查

### [make_icon.py](make_icon.py)
- 职责：由**品牌源图** `frontend/src/brand/logo.svg` 生成同目录 [`启动生图工作台.ico`](启动生图工作台.ico)——透明底 + 灰黑线条；`getBBox()` 取紧致取景、逐尺寸交给浏览器渲染、标准库按 ICO 规范（PNG 嵌入）打包成 16/24/32/48/64/128/256
- 同时写 [`icon-source.sha256`](icon-source.sha256)：生成那一刻源图的内容指纹。`check_docs.py` 拿它比对，源改了而产物没重生成就会红（用内容比对，不看修改时间——git 不保留时间，clone 后所有文件时间一样，判不出来）
- 危险级别：**低**（只写 ICO 与指纹两个文件）；**不改动品牌源图**
- 命令：`.\\.venv\\Scripts\\python.exe scripts\\make_icon.py`（可传输出路径做预览，不覆盖正式文件）
- 依赖：仅项目已有的 playwright（不引入新依赖）
- 改后验证：`python -c` 用 Pillow 读回 ICO 的 `sizes` 与 alpha 极值；或直接看资源管理器里入口图标的观感
- 注意：脚本按 `#475569` 匹配 `logo.svg` 的填充色，源色一变即报错退出，不静默产出错色图标；入口图标为何用快捷方式而非 exe，见[决策记录](../.agents/notes/2026-09-28-launcher-icon-and-shortcut.md)

### [migrate.py](migrate.py)
- 职责：存储迁移统一入口——注册表升级/重建/回填/迁目录（委托 `registry.migrate(apply, rebuild, backfill)`）、工作流升级（委托 `graphstore.migrate_workflows`）、历史账本回填（委托 `history.backfill_output_asset_ids`）
- 危险级别：**高**（写文件）
- 关键约定：**默认 dry-run 只报告，不写任何文件**；`--apply` 才落地（自带 `.bak-<ts>` 整文件备份 + tmp+os.replace 原子写 + 读回校验）
- 改后必测：`tests/test_core_migrate.py`（19 用例）+ `tests/test_core_history.py`（backfill 相关）
- **硬边界**：改 migrate.py / 任何存储格式逻辑（registry/workflow schema）→ 必须先 Handoff 确认，严禁自行决断

## 本地常用命令（在项目根目录执行）

```powershell
.\.venv\Scripts\python.exe scripts/migrate.py           # 先看报告（dry-run）
.\.venv\Scripts\python.exe scripts/migrate.py --apply   # 确认后再落地
python scripts/check_docs.py                            # 改文档后校验链接 + 仪表盘计数
```

## 该目录特有坑

- **`--apply` 前必须看 dry-run 报告**；脚本自带备份与幂等（重复执行结果不变），但迁移仍属破坏性操作
- 日常无需执行（迁移已完成于 8-20）；`output/.assets` 是唯一真相（.canvas 旧目录已删备份）
- 迁移完成后应跑 `tests/test_core_migrate.py` + 健康检查（起服务看 /api/health/details）

## 变更影响路由（改前必看）

- 改 `migrate.py`
  → 查委托目标：`core/registry.py`（migrate 系）、`core/graphstore.py`（migrate_workflows）、`core/history.py`（backfill）
  → 跑 `tests/test_core_migrate.py` + 相关模块测试
  → **必须 Handoff 确认后再提交**

## 参考

- 迁移设计：[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 5.5
- 被测模块：[../core/README.md](../core/README.md)（registry / graphstore / history 节）
- 维护仪表盘（数字/待办/坑）：[../AGENTS.md](../AGENTS.md)