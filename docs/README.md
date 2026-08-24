# docs/ — 提示词导入格式规范

- [`prompt-import-format.md`](prompt-import-format.md) — 通用粘贴导入格式（`=== 标题 ===` + 代码围栏 + `ratio: N:M`）
- [`ecom-prompt-import-format.md`](ecom-prompt-import-format.md) — 电商专用模板（固定轮播/详情批次）

解析实现与容错规则见 [frontend/src/promptImportFormat.ts](../frontend/src/promptImportFormat.ts)（单测 [promptImportFormat.test.ts](../frontend/src/promptImportFormat.test.ts)）。

架构与维护规范：设计决策见 [ARCHITECTURE.md](ARCHITECTURE.md)，维护仪表盘见 [../AGENTS.md](../AGENTS.md)。