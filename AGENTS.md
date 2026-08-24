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
* **历史导入与展示同源**：`/api/history/import` 导入白名单与 `/api/history` 展示共用 `resolve_history_asset_path`（注册表副本路径优先、回退 output 路径）——历史里看得到（exists=true）的图片必然能导入；白名单只来自账本记录，任意未记录路径拒绝（不退化任意路径读取）。细节见 ARCHITECTURE.md 9.7。
* **顶栏品牌区 3D**：左上角「logo + Imagora」借 React Bits DepthText 手法做 10 层挤出（`App.tsx` 顶部 `BRAND_LAYERS`/`BRAND_DEPTH`/`brandLayerColor` 可调，总深 ≈15px 克制偏浅），默认平面（挤出层被正面盖住）、鼠标靠近时立体摆动（指针跟随 ±11°，离开回摆平面），整体 `<a target="_blank">` 点击打开远程仓库。正面层比挤出层起点亮一档（基准色混白 12%，`LOGO_FACE_LIGHT`/`TEXT_FACE_LIGHT`），侧面渐变不变。实现与防错细节见 ARCHITECTURE.md 8.4。
* **预览统一（ZoomModal）**：画布与经典表单共用同一放大预览组件——`createPortal` 到 body 真全屏（避免动画 transform 祖先捕获 fixed，见 ARCHITECTURE.md 9.4 第 5 条），统一传注册表派生的完整 url（不传存储路径）；经典表单双击入口——参考图缩略图（UploadZone，单击不触发文件选择器）与结果图（Gallery，250ms 延时区分单击开原图/双击放大）。细节见 ARCHITECTURE.md 8.3。
* **行动按钮体系**：两档胶囊按钮（同源无边框 + 涟漪反转）——`btn-primary` 常态实底白字、hover 白色涟漪从中心向左右展开（白底+主题字）；`btn-ghost` 透明无边框、常态主题色文字、hover 主题色涟漪填充反白；`--btn-fill` 固定基础色。涟漪层为按钮同形层（`inset:0` + `scaleX(0)→1`，从中间往两边横向展开，任意宽度全覆盖）。状态类 `btn-busy`/`btn-draggable`/`btn-danger`，颜色跟随窗口主题色；画布选中操作栏即透明场景（毛玻璃 `bg-white/20` 面板 + 透明按钮）。非行动按钮（控件）不走本体系。实现与边界见 ARCHITECTURE.md 8.4。

## 验证状态（当前快照，Windows / Python 3.12.10 / ruff 0.16.2）

* **后端 pytest：205 passed**（命令 `uv run pytest --basetemp=C:/t/imagora-pytest`——项目路径含中文「网店实习」，须指 ASCII tmp 路径）。含 5 个 Windows 专属测试（netstat 端口探测 / powershell 父进程链 / C: 绝对路径 / 跨盘相对化），在 Windows 全部通过。历史导入与展示同源经 API 实跑验证：取真实历史 exists 记录 → 传展示返回的注册表副本路径（`output\.assets\canv_*.png`，原 output 文件在项目外且已移走）导入成功 `imported=1`；未记录任意路径（如 `C:\Windows\win.ini`）仍被拒绝（专项脚本为临时文件，用完即删）。
* **前端**：vitest **120 passed**（canvasDrop 新增 isInsideRect 单测 3 条）；`tsc --noEmit` + `vite build` 成功；`npm run lint` 零告警。品牌区 3D 交互经 Playwright 专项验证：默认平面（rest transform=none）→ 悬停倾倒 ±5.5° 方向跟随光标 → 移出回摆 0°，10 层挤出（总深 ≈15px）+ 各层颜色渐变正常，reduced-motion 模拟下行为一致，无 console 报错（专项脚本为临时文件，用完即删）。品牌区正面浅色经 Playwright 断言：正面层 logo fill / 标题色均为基准色混白 12%（`color-mix(... 88%, white)`），10 层挤出渐变仍以原基准色（`var(--color-brand)`/`#262626`）为起点（侧面不变），悬停立体倾斜正常，无 console 报错（专项脚本为临时文件，用完即删）。经典表单双击放大经 Playwright 验证：上传参考图 → 单击缩略图不触发文件选择器 → 双击弹出预览（图片自然尺寸加载成功）→ 滚轮缩放 100%→120% → Esc 关闭，无 console 报错（专项脚本为临时文件，用完即删）。预览全屏布局复验：容器/图片可视区 == 视口 1280×800，方图 800×800 占满，控制条悬浮底部不占位，缩放与 Esc 正常，无 console 报错（专项脚本为临时文件，用完即删）。行动按钮体系经 Playwright 样式断言：两档均胶囊圆角（computed 极大半径）；Primary 常态实底 + 白字（font-weight 600）、hover 涟漪 `scaleX(0)→1` 从中心向左右展开反转（白底 + 主题字）；Ghost 透明无边框 + 常态主题色文字（多窗口命中红/绿/紫主题色）+ hover 涟漪填充反白，无 console 报错（专项脚本为临时文件，用完即删）。长按钮覆盖经 Playwright 断言：579px 宽的「生成图片」涟漪层 computed 尺寸 == 按钮尺寸（任意宽度全覆盖），hover 后 `scaleX(0)→1` + 文字白→主题色反转；选中操作栏面板 `bg-white/20`（更透）+ 按钮透明底，无 console 报错（专项脚本为临时文件，用完即删）。选中操作栏透明按钮经 Playwright 验证：画布选中图片节点 → 操作栏出现；按钮常态透明底 + 胶囊（无边框，同源 primary）+ 主题色文字（多窗口命中红/绿）、hover 涟漪填充反白；「删除所选」透明红底 + 红字 #dc2626；图片节点选中时「运行所选」不出现（仅提示词卡片，符合设计）；无 console 报错（专项脚本为临时文件，用完即删）。
* **E2E** `frontend/e2e/verify_canvas.py`：**36/36 PASS**（Playwright headless，需先起服务：`.venv\Scripts\python.exe -m main ui --no-browser --port 7860`）。含拖到画布外松手取消：示意切「松开取消」+ 红色 X 图标（is-outside 类），不新建；拖回画布文案/图标恢复、仍新建。
* **ruff**：`uv run ruff check .` 零告警。

## 待办

* 无（维护会话任务 C/D 已完成：5 个目录 README + CI 草稿已提交）。

## 已知问题 / 注意

* `server.py` LSP 报「Argument missing for parameter id」是误报（GenerationTask.id 有 `default_factory`），pre-existing，勿修。
* pytest 必须 `--basetemp` 指向 ASCII 路径（`C:/t/imagora-pytest`），否则中文目录触发 tmp_path 坑。
* 前端 `dist/` 已构建（git 忽略）；`.omo/` 为废弃目录（git 忽略），勿再使用。
* 迁移（v1→v2 / 迁目录 / 历史回填）用 `scripts/migrate.py --apply`，用法见 ARCHITECTURE.md 5.5，日常无需执行。
* E2E（`verify_canvas.py`）只覆盖画布交互，**不触发生成链路**；未来若新增「生成→回流」E2E，必须先 mock `core/api.py` 的 `generate_image`（返回固定测试图），严禁 CI 直连真实上游（花钱）——落地前为 TODO，见 `.github/workflows/ci.yml` 头部第 4 条注释。
* `.github/workflows/ci.yml` 为**草稿**（未在真实仓库启用验证）：Backend Job 必须 `windows-latest`（5 个 Windows 专属测试）；`dist/` git 忽略 → E2E Job 需自行 `npm ci && npm run build`。

## 历史

轮次记录不留在本文档（防流水账），见 `git log`。格式演进：8-13 v1→v2 迁移雏形 → 8-20 存储统一 + 目录改名 + dry-run 预检 → 8-23 CLI 全量功能 + 资产旁路公共函数 → 8-23 Windows 平台验证 + ruff 清理 + 文档职责重构 → 8-23 粘贴导入去数量硬编码（双文档模板拆分）+ 架构文档同步清洗 → 8-23 顶栏品牌区 3D 挤出 + 指针跟随摆动 + 点击开远程仓库（三文档同步）→ 8-23 预览统一：经典表单参考图/结果图双击放大（复用画布 ZoomModal，传注册表 url）（三文档同步）→ 8-23 预览全屏：ZoomModal createPortal 到 body（修动画 transform 祖先捕获 fixed）+ 控制条悬浮（9.4 新增防错条，三文档同步）→ 8-23 行动按钮体系重设计：两档胶囊（primary 实底辉光 / ghost 描边涟漪 `--btn-fill`）+ btn-danger/btn-flat 状态类（三文档同步）→ 8-23 选中操作栏透明化：按钮常态透明 hover 涟漪（毛玻璃面板），移除无调用者的 btn-flat（三文档同步）→ 8-23 按钮涟漪横向化：primary 反转（白底主题字）+ 涟漪层改为 scaleX 从中心向左右展开（长按钮全覆盖）+ 选中栏面板更透 bg-white/20（三文档同步）→ 8-23 悬浮去缩放 + 涟漪加速 0.35s（三文档同步）→ 8-23 历史导入修复：导入白名单与展示同源（`resolve_history_asset_path` 注册表副本优先、回退 output）——历史里看得到即能导入，未记录路径仍拒绝（9.7 新增防错条，三文档同步）→ 8-23 品牌区正面浅色：正面层基准色混白 12%（`LOGO_FACE_LIGHT`/`TEXT_FACE_LIGHT`），3D 侧面渐变色不变（三文档同步）→ 8-23 工具栏拖出取消：提示词卡片/图片组拖到画布外松手不新建（示意切「松开取消」+ 红色 X 图标，拖回画布恢复），9.2 新增防错条（三文档同步）→ 8-23 清理备份：542MB `.canvas-bak-20260820-210134/` + 14 个旧工作流备份已删（删除后健康检查全绿，.assets 正常）→ 8-24 维护会话：核对通过（7.1 API 表↔实现一致、tests 清单齐全、pytest 205 / vitest 120 无漂移）；任务 C 为 core/frontend/tests/scripts/docs 各补目录 README（入口指针+快速命令+目录坑）；任务 D 起草 `.github/workflows/ci.yml`（三 Job：Windows 后端 + 前端构建 + E2E；E2E 生成链路 mock 记为 TODO）。