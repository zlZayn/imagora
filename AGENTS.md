# AGENTS.md — 维护索引（仪表盘 + 变更路由）

> 全局索引：本项目只放仪表盘与变更路由。模块细节查子目录 README 手册，设计/决策/防错查 [ARCHITECTURE.md](ARCHITECTURE.md)，用户用法查 [README.md](README.md)。

## 变更速查（改代码前先查这里）

- 改 core/ 任意文件 → 查 [core/README.md](core/README.md) 文件索引 → 跑 `pytest tests/test_core_*.py` → 如改设计同步 [ARCHITECTURE.md](ARCHITECTURE.md)
- 改 [server.py](server.py) 路由 → 查 core/README.md（registry/graphstore/history 节）→ 跑 `pytest tests/test_server_*.py` → 同步 [frontend/src/types.ts](frontend/src/types.ts) + [frontend/src/api.ts](frontend/src/api.ts) + ARCHITECTURE 7.1 表
- 改 frontend/src/ 纯函数 → 查 [frontend/README.md](frontend/README.md) 文件索引 → 跑 `npm test`（有单测即够，无需文档）
- 改 frontend/components/ UI → 查 frontend/README.md 组件索引 → 跑 `npm test` + [E2E](frontend/e2e/verify_canvas.py) → 样式改 [index.css](frontend/src/index.css)
- 改 [scripts/migrate.py](scripts/migrate.py) 或存储格式 → 查 [scripts/README.md](scripts/README.md) → 跑 `pytest tests/test_core_migrate.py` → **必须先 Handoff 确认（硬边界）**
- 改测试文件 → 查 [tests/README.md](tests/README.md) → 按模块筛选跑 → 增/删用例后更新本文档「仪表盘」数字

## 仪表盘（最近验证快照）

- 后端 pytest：**205 passed**（命令与逐文件覆盖见 [tests/README.md](tests/README.md)）
- 前端 vitest：**120 passed**；tsc + vite build 成功；lint / ruff 零告警（命令见 [frontend/README.md](frontend/README.md)、[tests/README.md](tests/README.md)）
- E2E [verify_canvas.py](frontend/e2e/verify_canvas.py)：**36/36 PASS**（前置：起 7860 服务，见 [frontend/README.md](frontend/README.md)）
- 迁移（v1→v2 / .canvas→.assets / 账本回填）已完成，日常无需执行（见 [scripts/README.md](scripts/README.md)）

## 待办

- 无（8-23 备份清理；8-24 文档体系重构 + CI 完善已完成）

## 活跃坑 / 注意

- pytest 必须带 `--basetemp` 指向 ASCII 临时目录（工作目录含中文触发 tmp_path 坑；CI 用 `${{ runner.temp }}`，见 [.github/workflows/ci.yml](.github/workflows/ci.yml)）
- [server.py](server.py) LSP 报「Argument missing for parameter id」是误报（GenerationTask.id 有 default_factory），勿修
- `dist/` git 忽略：改前端后 `npm run build` 才在浏览器生效；CI/E2E 须自建（见 [frontend/README.md](frontend/README.md)）
- E2E 只测画布交互、不触发生成链路；未来覆盖「生成→回流」前必须先 mock [core/api.py](core/api.py) 的 `generate_image`（ci.yml 注释 TODO）
- 迁移脚本/存储格式改动属硬边界——必须维护者确认，不自行决断

## 文档地图

| 想了解 | 去读 |
| --- | --- |
| 设计决策 / 数据流 / 契约 / 防错清单 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| core/ 每文件职责 / 导出 / 依赖 / 改后必测 | [core/README.md](core/README.md) |
| frontend/ 纯函数 / hooks / 组件 / E2E 前置 | [frontend/README.md](frontend/README.md) |
| 测试文件 ↔ 被测代码映射 / 特殊坑 | [tests/README.md](tests/README.md) |
| 迁移脚本用法 / 危险级别 | [scripts/README.md](scripts/README.md) |
| 提示词导入格式规范 | [docs/README.md](docs/README.md) |

历史轮次记 git log，不堆本文档。