# scripts/ — 一次性迁移/修复脚本

## migrate.py — 存储迁移（危险，默认只报告）

v1→v2 注册表升级 / 目录改名（`.canvas` → `.assets`）/ 历史账本回填。**默认 dry-run 只打印报告，不写任何文件**。

```powershell
.\.venv\Scripts\python.exe scripts/migrate.py           # 先看报告
.\.venv\Scripts\python.exe scripts/migrate.py --apply   # 确认后再落地（自带 .bak-<ts> 整文件备份 + 原子写）
```

## 本目录的坑

- **`--apply` 前必须看 dry-run 报告**；脚本自带备份与幂等，但迁移是破坏性操作。
- 改迁移逻辑后跑 `tests/test_core_migrate.py`（19 用例）与 `tests/test_core_history.py`（backfill 相关）。
- 日常无需执行（迁移已完成），细节见 [../ARCHITECTURE.md](../ARCHITECTURE.md) 5.5。