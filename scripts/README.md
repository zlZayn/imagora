# scripts/ — 一次性迁移/修复脚本

**危险等级：迁移脚本是破坏性操作，`--apply` 前必须 dry-run + 人工确认（Handoff 硬边界：改迁移逻辑/存储格式必须维护者确认）。**

## 文件索引

### [window_accent.ps1](window_accent.ps1)
- 职责：窗口主题色 RGB 计算（黄金角 137.508 / HSL 55%,42% → 输出 "R G B"）——**与 `frontend/src/accent.ts`、`main.py:accent_for_window` 同一算法的 PowerShell 实现**，供启动脚本首窗提示按该窗口主题色着色（终端 24-bit ANSI）
- 被谁依赖：根目录 `启动生图工作台.cmd`（`powershell -File scripts\window_accent.ps1 -WindowId N`）
- 危险级别：低（只读计算，不写文件）
- 注意：**算法三处同源**（accent.ts / main.py / 本脚本），改色相/饱和/明度必须三处同步，勿单独改动；命令串含括号不便嵌入 cmd 的 for /f，故抽成独立脚本
- 改后验证：`powershell -File scripts\window_accent.ps1 -WindowId 1` 对照 `python -c "import main; print(main.accent_for_window(1))"` 的 #rrggbb

### [check_docs.py](check_docs.py)
- 职责：文档完整性校验——相对 markdown 链接可解析 + 仪表盘测试计数与源码一致（后端数 `def test_`、前端数 `it()`，逐处比对 AGENTS / tests/README / ARCHITECTURE / frontend/README 的声明数字）
- 危险级别：**低**（只读，不写任何文件）
- 命令：`python scripts/check_docs.py`（`--quiet` 只出问题）；退出码 0=通过 / 1=有断链或计数漂移
- 改后必测：`python scripts/check_docs.py` 自检（改文档后跑一次即可，无需单测——脚本本身即校验器）
- 背景：计数分散多处人工同步易漏（曾出现 221→222 漏改、frontend 145 过时数字），脚本把「数字与源码一致」从纪律变成可执行检查

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