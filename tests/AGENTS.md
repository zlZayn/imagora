# tests/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

tests/ 特有约束：
- pytest 用默认临时目录即可；若报 WinError 5（`%TEMP%\pytest-of-speak` 的 ACL 曾被改坏，多为管理员权限进程遗留），删掉该目录后 pytest 自动重建，处理方式见 [README.md](README.md) 坑清单
- 测试数字是根 [AGENTS.md](../AGENTS.md) 仪表盘数据源：增/删用例后必须同步数字；数字意外漂移先报告，不擅改
- 不调真实上游 API（花钱）、不跑真实生成链路；路由测试 `from server import ...` 属预期
- 文件索引（逐文件用例 / 覆盖 / 变更路由）→ [README.md](README.md)，不在此重复
- 测试规范与数字口径 → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 10
