# scripts/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

scripts/ 特有约束：
- 启动入口链路是「根目录 `启动生图工作台.exe` → `desktop/启动生图工作台.cmd`」：exe 里烘焙的是那条相对路径，图标是编译期内嵌的，两者任一改动都要重跑 `desktop/make_launcher.ps1` 才生效；`desktop/启动生图工作台.cmd` 内的 `pushd "%~dp0..\.."` 是把工作目录切回项目根的关键，移动脚本时不可删除。入口链路的其余约束与本机验证顺序见 [desktop/AGENTS.md](desktop/AGENTS.md)
- `migrate.py` 默认 dry-run 只报告；`--apply` 前必看报告（破坏性操作）
- 改迁移逻辑 / 任何存储格式（registry/workflow schema）属硬边界——必须先维护者确认，不自行决断
- 用法 / 危险级别 / 变更路由 → [README.md](README.md)，不在此重复
- 迁移设计背景 → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 5.5
