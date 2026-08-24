# scripts/ — 一次性迁移/修复脚本

**危险等级：迁移脚本是破坏性操作，`--apply` 前必须 dry-run + 人工确认（Handoff 硬边界：改迁移逻辑/存储格式必须维护者确认）。**

## 文件索引

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

- 迁移设计：`ARCHITECTURE.md` 5.5
- 被测模块：[../core/README.md](../core/README.md)（registry / graphstore / history 节）