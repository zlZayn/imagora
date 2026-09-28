# scripts/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

scripts/ 特有约束：
- 启动入口链路是「根目录 `.lnk` → 本目录 `启动生图工作台.cmd`」：脚本内 `pushd "%~dp0.."` 是把工作目录切回项目根的关键，移动脚本时不可删除；改入口结构时同步 `.lnk` 与 [README.md](README.md) 的说明
- `migrate.py` 默认 dry-run 只报告；`--apply` 前必看报告（破坏性操作）
- 改迁移逻辑 / 任何存储格式（registry/workflow schema）属硬边界——必须先维护者确认，不自行决断
- 用法 / 危险级别 / 变更路由 → [README.md](README.md)，不在此重复
- 迁移设计背景 → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 5.5
