# AGENTS.md — 项目交接与维护状态

> **自维护文档**：每次工作完成后，就地更新本文档（验证状态、待办、已知问题），保持与代码同步。文档滞后即技术债。
> **放置约定**：固定放项目根目录，主流 AI 编程 agent 启动时自动发现并注入上下文。统一维护这一份，不再使用 `.omo/CONTEXT.md`（已废弃）。

## 文档职责分工

| 文档 | 面向 | 内容边界 |
| --- | --- | --- |
| [README.md](README.md) | 用户 | 用途 + 用法，只引用不展开技术细节 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 开发者 | 结构 / 模块 / 数据流 / 设计决策 / 防错清单（技术细节唯一归宿） |
| AGENTS.md（本文档） | 维护者 / agent | 当前状态 + 验证结果 + 待办 + 已知问题（历史记 git，不堆轮次） |

## 当前状态

* **项目**：AI 生图工作台。FastAPI 单端口服务（`server.py` + `core/`）托管 React SPA（`frontend/`），唯一外部依赖是 `core/api.py` 调用的上游生图 API；本地单机工具，产物全落 `output/`（git 忽略）。
* **存储**（详见 ARCHITECTURE.md 2.2 / 5.5）：`.assets/` 资产注册表（v2，内容 sha1 去重，kind=canvas/result/ref）+ `workflows/` 工作流 + `submissions/` 提交快照 + `logs/generation.jsonl` 账本；图片节点只存 registryId，路径由 `resolve_asset` 实时重建。
* **CLI 与 web 对等**：`main.py` 五个子命令 `ui`/`menu`/`batch`/`gen`/`config`；`gen` 与网页表单完全对等，资产旁路统一走 `graphstore.persist_submission_assets`（server / CLI 共用，不两端分叉）。
* **提示词粘贴导入**：解析器 `parsePromptImportFormat` 数量不设上限、不校验固定数（仅格式错误进 issues 标红），弹窗只显示「识别 N 张」；通用格式规范见 `docs/prompt-import-format.md`，电商专用模板（固定轮播/详情批次）见 `docs/ecom-prompt-import-format.md`。
* **顶栏品牌区 3D**：左上角「logo + Imagora」借 React Bits DepthText 手法做 10 层挤出（`App.tsx` 顶部 `BRAND_LAYERS`/`BRAND_DEPTH`/`brandLayerColor` 可调，总深 ≈15px 克制偏浅），默认平面（挤出层被正面盖住）、鼠标靠近时立体摆动（指针跟随 ±11°，离开回摆平面），整体 `<a target="_blank">` 点击打开远程仓库。实现与防错细节见 ARCHITECTURE.md 8.4。
* **预览统一（ZoomModal）**：画布与经典表单共用同一放大预览组件，统一传注册表派生的完整 url（不传存储路径）；经典表单双击入口——参考图缩略图（UploadZone，单击不触发文件选择器）与结果图（Gallery，250ms 延时区分单击开原图/双击放大）。细节见 ARCHITECTURE.md 8.3。

## 验证状态（当前快照，Windows / Python 3.12.10 / ruff 0.16.2）

* **后端 pytest：204 passed**（命令 `uv run pytest --basetemp=C:/t/imagora-pytest`——项目路径含中文「网店实习」，须指 ASCII tmp 路径）。含 5 个 Windows 专属测试（netstat 端口探测 / powershell 父进程链 / C: 绝对路径 / 跨盘相对化），在 Windows 全部通过。
* **前端**：vitest **117 passed**；`tsc --noEmit` + `vite build` 成功；`npm run lint` 零告警。品牌区 3D 交互经 Playwright 专项验证：默认平面（rest transform=none）→ 悬停倾倒 ±5.5° 方向跟随光标 → 移出回摆 0°，10 层挤出（总深 ≈15px）+ 各层颜色渐变正常，reduced-motion 模拟下行为一致，无 console 报错（专项脚本为临时文件，用完即删）。经典表单双击放大经 Playwright 验证：上传参考图 → 单击缩略图不触发文件选择器 → 双击弹出预览（图片自然尺寸加载成功）→ 滚轮缩放 100%→120% → Esc 关闭，无 console 报错（专项脚本为临时文件，用完即删）。
* **E2E** `frontend/e2e/verify_canvas.py`：**31/31 PASS**（Playwright headless，需先起服务：`.venv\Scripts\python.exe -m main ui --no-browser --port 7860`）。
* **ruff**：`uv run ruff check .` 零告警。

## 待办

* 删 542MB 备份 `output/.canvas-bak-20260820-210134/`（目录改名全量备份，与 `.assets` 同内容）：删除前提「应用从 .assets 正常运行」已满足（服务正常启动、E2E 全过），属破坏性操作，人工确认后执行 `rm -rf`。
* `output/workflows/*.bak-20260820-181820`（14 个 v1 旧工作流备份）可随时删。

## 已知问题 / 注意

* `server.py` LSP 报「Argument missing for parameter id」是误报（GenerationTask.id 有 `default_factory`），pre-existing，勿修。
* pytest 必须 `--basetemp` 指向 ASCII 路径（`C:/t/imagora-pytest`），否则中文目录触发 tmp_path 坑。
* 前端 `dist/` 已构建（git 忽略）；`.omo/` 为废弃目录（git 忽略），勿再使用。
* 迁移（v1→v2 / 迁目录 / 历史回填）用 `scripts/migrate.py --apply`，用法见 ARCHITECTURE.md 5.5，日常无需执行。

## 历史

轮次记录不留在本文档（防流水账），见 `git log`。格式演进：8-13 v1→v2 迁移雏形 → 8-20 存储统一 + 目录改名 + dry-run 预检 → 8-23 CLI 全量功能 + 资产旁路公共函数 → 8-23 Windows 平台验证 + ruff 清理 + 文档职责重构 → 8-23 粘贴导入去数量硬编码（双文档模板拆分）+ 架构文档同步清洗 → 8-23 顶栏品牌区 3D 挤出 + 指针跟随摆动 + 点击开远程仓库（三文档同步）→ 8-23 预览统一：经典表单参考图/结果图双击放大（复用画布 ZoomModal，传注册表 url）（三文档同步）。