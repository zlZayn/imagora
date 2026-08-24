# AGENTS.md — tests/

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

tests/ 特有约束：
- pytest 必须带 `--basetemp` 指向 ASCII 临时目录（工作目录含中文，默认 tmp 路径触发 tmp_path 坑）
- 测试数字是根 [AGENTS.md](../AGENTS.md) 仪表盘数据源：增/删用例后必须同步数字；数字意外漂移先报告，不擅改
- 不调真实上游 API（花钱）、不跑真实生成链路；路由测试 `from server import ...` 属预期
- 文件索引（逐文件用例 / 覆盖 / 变更路由）→ [README.md](README.md)，不在此重复
- 测试规范与数字口径 → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 10
