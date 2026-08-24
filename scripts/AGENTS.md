# AGENTS.md — scripts/

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

scripts/ 特有约束：
- `migrate.py` 默认 dry-run 只报告；`--apply` 前必看报告（破坏性操作）
- 改迁移逻辑 / 任何存储格式（registry/workflow schema）属硬边界——必须先维护者确认，不自行决断
- 用法 / 危险级别 / 变更路由 → [README.md](README.md)，不在此重复
