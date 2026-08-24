# AGENTS.md — core/

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

core/ 特有约束：
- 无 HTTP 纯逻辑层：**不得 import `server.py` / `main.py`**（反向依赖铁律，grep 兜底）
- 单测绝不真调上游生图 API（花钱）：`api.py` 走 monkeypatch mock，保持接口可注入
- 改存储格式（registry / graphstore schema、字段语义）属硬边界——必须先维护者确认，不自行决断
- 文件索引（职责 / 导出 / 被谁依赖 / 改后必测）→ [README.md](README.md)，不在此重复
- 设计背景（注册表/分层/防错）→ [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
