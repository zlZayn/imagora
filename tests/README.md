# tests/ — 测试层（pytest 后端 + vitest 前端）

FastAPI 路由级 + 纯逻辑测试，**不调真实上游 API、不花钱**。前端测试同前端仓库（`frontend/src/*.test.ts*`）。

## 本地常用命令（在项目根目录执行）

```powershell
# 后端全量（258 用例）
.\.venv\Scripts\python.exe -m pytest --basetemp=<ASCII 临时目录>
# 按模块筛选
.\.venv\Scripts\python.exe -m pytest tests/test_core_config.py tests/test_server_helpers.py --basetemp=<ASCII 临时目录>
# 前端（frontend/ 目录内）
cd frontend; npm test
```

## 该目录特有坑

- **必须 `--basetemp=<ASCII 可写目录>`**：默认 `%TEMP%\pytest-of-speak` 权限异常（WinError 5），不指定 setup 即报错（已知问题，勿忘）
- **用户数据默认隔离（autouse `isolate_user_data`，见 conftest.py）**：输出目录 / 注册表 / 工作流 / 账本 / 预算一律指向 `tmp_path`。历史上 `asset_iso` 是 opt-in，漏用的用例会把测试图片写进真实 `output/.assets`（实测：跑一次 pytest 就多出 3 个假资产，反复复现）——新增用例无需再声明夹具，但**不得构造指向真实用户目录的路径**
- **5 个 Windows 专属测试**：netstat 端口探测 / powershell 父进程链 / C: 绝对路径 / 跨盘相对化——只在 Windows 通过；CI 相关 Job 必须 `windows-latest`
- 路由测试直接 `from server import ...`（import 即建 FastAPI app，属预期）
- **测试数字是 AGENTS 仪表盘数据源**：增/删测试用例必须同步 AGENTS「当前仪表盘」；数字意外变化（非新增导致）必须报告维护者

## 文件索引（后端 pytest，共 258）——每个 test_*.py 测什么

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| [`test_core_api.py`](test_core_api.py) | 18 | 尺寸解析 / 默认输出路径（并发唯一）/ 错误格式化 / 写文件瞬时锁重试 |
| [`test_core_batch.py`](test_core_batch.py) | 10 | 配置读取 / 路径解析 / 模块过滤 / dry-run |
| [`test_core_config.py`](test_core_config.py) | 15 | API Key 跟随 profile / profile 解析优先级与缺失回退 / 白名单校验 / RATIOS 表结构 |
| [`test_core_cost.py`](test_core_cost.py) | 21 | 账本聚合（成功/失败计数、成功率、费用只算成功行、按天窗口与倒序、按尺寸/模式、坏行与脏类型容错、空账本）/ 今日花费 / 预估费用（已知/未知尺寸、非法张数）/ 预算规范化与读写（缺失/损坏/原子写无残留）/ 超预算判定（不限放行、单次上限、当日已花+预估、双限、remaining） |
| [`test_core_logging.py`](test_core_logging.py) | 8 | 日志写入 / 并发串行 / 路径相对化 |
| [`test_core_history.py`](test_core_history.py) | 16 | 历史读取 / 坏行容忍 / 筛选 / **搜索换行归一（CRLF 粘贴可命中）** / **同参数聚合（失败去重只留最新、成功吸收失败、时间不算参数、任一参数不同不合并、inputAssetIds 参与判定）** / **分页（聚合后切片与 total、offset 越界、与搜索/状态一致）** / backfill（报告·补齐·幂等·跳过无法反查·坏行保留） |
| [`test_core_canvas.py`](test_core_canvas.py) | 32 | 注册表（v2+v1 兼容）/ 内容去重 / import 边界 / kind 来源标签 / workflow 归一化与自愈 / recovery / submission / persist_submission_assets |
| [`test_core_imageinfo.py`](test_core_imageinfo.py) | 10 | PNG/JPEG/GIF/WebP/BMP 头解析 / 垃圾与截断返回 None |
| [`test_core_migrate.py`](test_core_migrate.py) | 19 | 注册表 detect/升级/重建/回填/迁目录 / 工作流升级 / CLI 端到端 |
| [`test_core_tasks.py`](test_core_tasks.py) | 11 | 任务状态机 / 并发上限 / 取消 / 快照 / TTL 清理 |
| [`test_core_pathtrust.py`](test_core_pathtrust.py) | 2 | 路径白名单（match_roots 双根/单根/跨盘） |
| [`test_server_helpers.py`](test_server_helpers.py) | 24 | 窗口分配 / 安全路径白名单 / upload-ref / delete-ref / generate 同步性 / history 注册表解析 + inputRefs/inputRefMissing / **/api/history 分页 hasMore** / _persist_submission 含 temp_bases / 导入与展示同源（注册表副本 + 账本 output 原路径双收，含画布回流回归） |
| [`test_server_canvas.py`](test_server_canvas.py) | 18 | canvas 路由 / workflow 往返（v2）/ missing 收集 / ref_paths 放行 |
| [`test_server_tasks.py`](test_server_tasks.py) | 10 | generate 提交即返回 / multipart 临时文件清理 + temp 参考图注册账本 / **参考图提交时注册（源文件删后账本仍完整）** / 保存消息为绝对路径 / 路径校验 / 任务路由 |
| [`test_server_cost.py`](test_server_cost.py) | 15 | /api/history/stats 聚合与 days 窗口、空账本 / 预算读写（默认不限、落盘回读）/ /api/budget/check 预检（按张数、按 items、单次上限边界）/ /api/generate 预算闸门（超限 409 → 确认后放行、不限不拦）/ /api/generate/batch（合法提交 + 空提示词/坏参考图逐条跳过、空 items 400、全非法不提交、超预算未确认不提交、确认后提交） |
| [`test_main_process.py`](test_main_process.py) | 4 | 端口探测 / 祖先链回溯（Windows） |
| [`test_main_cli.py`](test_main_cli.py) | 25 | CLI gen 子命令全链路（校验/输出解析/文生图+图生图+多参考/失败/--no-asset/比例档位）/ config 输出 |

## 文件索引（前端 vitest，共 202，位于 frontend/src/）

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| [`layout.test.ts`](../frontend/src/layout.test.ts) | 29 | 分层布局 / 复杂连接 / 局部整理不漂移 / 多对多摊平 |
| [`workflow.test.ts`](../frontend/src/workflow.test.ts) | 48 | 自动连线 / 动画类 / 连线约束 / 落点阶梯 / 节点构建器 / **updatePromptNode 幂等（无变化不产生新引用，防 running 逐秒重渲染）** / **canConnect 连线规则（组连组中转）** / **computeCounts 组链递归聚合 + 去重口径（重复条目数）+ 防环** / **引用溯源（数据最终流到的提示词数）** / **collectIncomingImages 嵌套组链展开** |
| [`canvasDrop.test.ts`](../frontend/src/canvasDrop.test.ts) | 14 | 拖拽意图解析 / 文件识别 / 数量统计 / 示意文案 / isInsideRect |
| [`previewZoom.test.ts`](../frontend/src/previewZoom.test.ts) | 5 | 缩放范围 / 平移夹紧 |
| [`canvasHistory.test.ts`](../frontend/src/canvasHistory.test.ts) | 2 | 撤销 / 恢复 / 新分支清空 |
| [`canvasStyles.test.ts`](../frontend/src/canvasStyles.test.ts) | 4 | 动效 CSS 选择器约束 |
| [`recovery.test.ts`](../frontend/src/recovery.test.ts) | 4 | 快照剥离动画类 / 运行期字段清除 |
| [`useGenerationTask.test.ts`](../frontend/src/useGenerationTask.test.ts) | 6 | hook 稳定成员引用 + **超预算确认（409→确认→带 allowOverBudget 重提、取消则抛出、同实例只问一次、非 409 不触发确认）** |
| [`useImageZoom.test.ts`](../frontend/src/useImageZoom.test.ts) | 4 | 单击开原图 / 双击放大时序（fake timers）/ 卸载清理 |
| [`logPath.test.ts`](../frontend/src/logPath.test.ts) | 6 | 日志路径词条解析（绝对/相对、正反斜杠、多路径、扩展名大小写） |
| [`CanvasNodes.test.tsx`](../frontend/src/components/CanvasNodes.test.tsx) | 12 | 节点操作栏 / 双击行为 / 组卡去重提示渲染 |
| [`ResultPanel.test.tsx`](../frontend/src/components/ResultPanel.test.tsx) | 7 | 结果区 5 态面板 / 切换交叉淡化（旧层保留至淡出移除） |
| [`WorkflowModals.test.tsx`](../frontend/src/components/WorkflowModals.test.tsx) | 2 | ZoomModal Portal 点击隔离（点图片/空白不误关外层宿主遮罩） |
| [`HistoryGallery.test.tsx`](../frontend/src/components/HistoryGallery.test.tsx) | 16 | 列表行渲染 / 参考图缺失琥珀提示 / 失败文案 / 提示词截断浮层（仅截断弹、跟随、离开消失） / **分页（首屏第 0 页、点加载更多按 offset 追加、搜索与状态筛选重置第 0 页、滚动接近底部自动追加、远离底部不触发）** / **成本看板指标、失败行「重跑」与成功行按钮差异、参考图丢失禁用+条数提示、批量重跑确认弹窗（预估费用/校验调用/提交参数）、超预算警示与 allowOverBudget、保存预算回读** |
| [`promptImportFormat.test.ts`](../frontend/src/promptImportFormat.test.ts) | 19 | 导入格式解析容错 / 尺寸映射 / 建卡 |
| [`cost.test.ts`](../frontend/src/cost.test.ts) | 6 | 金额/比例/耗时格式化（非法值回退 -）/ 预算摘要（不限与设限两种、兼容预检结果的 settings 形态）/ 看板主指标行顺序与文案 |
| [`api-guards.test.ts`](../frontend/src/api-guards.test.ts) | 9 | `/api` 响应形状守卫（必填字段类型、可选字段「在但类型错」、多出的键放行） |
| [`rerun.test.ts`](../frontend/src/rerun.test.ts) | 9 | 可重跑判定（成功记录、空提示词、缺尺寸/质量、图生图参考图丢失、参考图仍在、纯文生图）/ 分组与丢失计数 / 批量参数构造（空 path 丢弃）/ 跳过原因聚合排序 |

## 变更影响路由（改前必看）

- 改 `core/registry.py` / `graphstore.py` → `test_core_canvas.py` + `test_core_migrate.py` + 相关 server 测试
- 改 `core/config.py` → `test_core_config.py`（新增 profile 键必须同步白名单测试）
- 改 `core/cost.py` → `test_core_cost.py` + `test_server_cost.py`（统计口径变化必须同步 ARCHITECTURE 7.1 的 /api/history/stats 说明）
- 改前端 `cost.ts` / `rerun.ts` → 同名 `*.test.ts`；改历史面板重跑交互 → `HistoryGallery.test.tsx`
- 改 `core/history.py` → `test_core_history.py` + `test_server_helpers.py`（展示/导入同源）
- 改 `core/api.py` → `test_core_api.py` + `test_main_cli.py`
- 改 `server.py` 路由 → 对应 `test_server_*.py` + 前端 `types.ts`/`api.ts`
- 改前端纯函数 → 对应 `*.test.ts`（同目录同名）
- 改前端组件 → 组件单测 + E2E（`../frontend/e2e/verify_canvas.py`，36 断言）
- **增/删用例后更新 AGENTS「当前仪表盘」数字**

## CI 要求

- Backend Job：**windows-latest**（5 个 Windows 专属测试）
- `--basetemp` 指向 ASCII 临时目录（本地自选目录，CI 用 `${{ runner.temp }}`，见 ci.yml）
- 细节见 [../.github/workflows/ci.yml](../.github/workflows/ci.yml)（草稿）

## 参考

- 测试规范与数字口径：[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 10
- 被测模块手册：[../core/README.md](../core/README.md)、[../frontend/README.md](../frontend/README.md)
- 维护仪表盘（数字/待办/坑）：[../AGENTS.md](../AGENTS.md)