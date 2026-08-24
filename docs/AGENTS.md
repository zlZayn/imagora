# docs/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

docs/ 特有约束：
- 只收辅助文档：`ARCHITECTURE.md`（设计圣经，必须）+ 格式规范（prompt-import-format / ecom-prompt-import-format）+ 按需（postmortem / PLAN）；不再混入其他内容
- 格式规范文件被 `frontend/src/promptImportFormat.ts` 消费：改规范必须同步解析器与单测（前端侧）
- 文件索引 → [README.md](README.md)，不在此重复
- 设计背景（存储模型/数据流）→ [ARCHITECTURE.md](ARCHITECTURE.md)（同目录）
