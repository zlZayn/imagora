# AGENTS.md — 跨会话仪表盘

> 本文档只做**全局仪表盘 + 变更路由**（<80 行）。模块细节查子 README 模块手册，设计/决策/防错查 [ARCHITECTURE.md](ARCHITECTURE.md)。文档地图见文末。

## 变更速查（改代码前先查这里）

- 改 core/ 任意文件 → 查 [core/README.md](core/README.md) 文件索引 → 跑 `pytest tests/test_core_*.py` → 如改设计同步 ARCHITECTURE.md
- 改 server.py 路由 → 查 core/README.md（registry/graphstore/history 节）→ 跑 `pytest tests/test_server_*.py` → 同步 frontend/src/types.ts + api.ts + ARCHITECTURE 7.1 表
- 改 frontend/src/ 纯函数 → 查 [frontend/README.md](frontend/README.md) 文件索引 → 跑 `npm test`（有单测即够，无需文档）
- 改 frontend/components/ UI → 查 frontend/README.md 组件索引 → 跑 `npm test` + E2E（verify_canvas.py）→ 样式改 index.css
- 改 scripts/migrate.py 或存储格式 → 查 [scripts/README.md](scripts/README.md) → 跑 `pytest tests/test_core_migrate.py` → **必须先 Handoff 确认（硬边界）**
- 改测试文件 → 查 [tests/README.md](tests/README.md) → 按模块筛选跑 → 增/删用例后更新本文档「仪表盘」数字

## 仪表盘（最近验证快照）

- 后端 pytest：**205 passed**（命令必带 `--basetemp=C:/t/imagora-pytest`——项目路径含中文「网店实习」）
- 前端 vitest：**120 passed**；`tsc --noEmit` + `vite build` 成功；`npm run lint` / `uv run ruff check .` 零告警
- E2E `frontend/e2e/verify_canvas.py`：**36/36 PASS**（先起服务：`.venv\Scripts\python.exe -m main ui --no-browser --port 7860`）
- 迁移（v1→v2 / .canvas→.assets / 账本回填）已于 8-20 完成，日常无需执行

## 待办

- 无（8-23 备份清理完成；8-24 文档体系重构完成 + CI 草稿已提交）。CI 启用前复核项见「活跃坑」。

## 活跃坑 / 注意

- pytest 必须 `--basetemp=C:/t/imagora-pytest`（中文目录触发 tmp_path 坑）
- server.py LSP 报「Argument missing for parameter id」是误报（GenerationTask.id 有 default_factory），勿修
- `dist/` git 忽略：改前端后 `npm run build` 才在浏览器生效；CI/E2E 须自建 dist
- E2E 只测画布交互、不触发生成链路；未来覆盖「生成→回流」前必须先 mock `core/api.py` 的 `generate_image`（ci.yml 注释 TODO）
- `.github/workflows/ci.yml`：Backend/E2E 已用 job 级 `env: UV_INDEX_URL: https://pypi.org/simple` 显式覆盖 tuna 镜像（海外 runner 超时风险已消除），本地 pyproject.toml 镜像配置保持不动；Backend 必须 windows-latest（5 个 Windows 专属测试）。未在真实仓库实测过，首次 push 触发后需看一眼结果
- 迁移脚本/存储格式改动属硬边界——必须维护者确认，不自行决断

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [README.md](README.md) | 用户视角：用途 + 用法 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 宏观索引：结构图谱 / 数据流 / 设计决策 / 契约（7.1）/ 防错清单（第 9 章） |
| [core/README.md](core/README.md) | core 模块手册：每文件职责 / 导出 / 被谁依赖 / 改后必测 / 变更路由 |
| [frontend/README.md](frontend/README.md) | 前端模块手册：纯函数 / hooks / 组件 / E2E 前置 |
| [tests/README.md](tests/README.md) | 测试文件索引：逐文件用例 / 覆盖 / 变更路由 |
| [scripts/README.md](scripts/README.md) | 迁移脚本手册：危险级别 / dry-run 先行 / 硬边界 |
| [docs/README.md](docs/README.md) | 提示词导入格式规范指向 |

历史轮次不再堆在本文档（防流水账），见 `git log`。