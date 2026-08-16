# 上下文交接文档（CONTEXT）

> 维护约定：本文件随工作进展持续更新，记录跨会话交接所需的关键事实——当前工作、架构决策、验证状态、已知问题。交接时先读这里。

## 当前工作（2026-08-13，画布体验重构）

**前端画布交互打磨 + 任务中心下线 + 文档同步**。状态：全部完成，tsc / lint / 64 用例 / build 全绿，dist 已重新构建。

## 当前工作（2026-08-13，架构文档重写）

**ARCHITECTURE.md 全量重写**：去除全部 ASCII 图，改为文字化关系描述 + 多级标题（11 章：概览/模块/运行/后端/前端/数据流/契约/决策/防错清单/测试/变更守则）；新增「防错清单」章节把历史 bug 沉淀为规范（React Flow 陷阱/事件时序/状态引用/CSS 动效/坐标几何/进程并发，每条含现象→根因→规范→测试保障）；新增「变更守则」指导持续开发。事实核对：测试用例数、API 表、模块清单与代码一致；TaskCenter/便携版引用零残留。

## 当前工作（2026-08-13，浮层弱化）

**选中操作栏与画布日志透明化**：操作栏改半透明毛玻璃（bg-white/50 + backdrop-blur，hover 变实），日志文字降为低饱和中性色——两者平时不遮挡画布内容。ARCHITECTURE 5.4 同步（补画布日志条目 + 操作栏样式说明）。纯样式改动，无逻辑变化。

### 本次改动（全部前端 + 文档，后端零改动）

- **自定义画布光标**：index.css 给 .react-flow__pane 换高对比十字准星 SVG data-URI 光标（黑描边+白内描边+蓝心，热点居中），.dragging 切抓手——空白画布上不再"找不到鼠标"
- **右键拖拽框选修复**：CanvasPage 右键拖拽期间在 window 捕获阶段屏蔽 contextmenu（rightDownRef 标记按下→松开），指针拖出画布/在工具栏松开不再弹浏览器默认菜单；mouseup 本就挂 window，画布外松开框选照常落定；非拖拽时仍只屏蔽画布内非输入区（输入框保留原生粘贴/复制菜单）
- **选中操作栏升级**：selectedCount >= 1 即显示（替代旧 >= 2）——「运行所选」（handleRunSelected，只跑选中提示词卡片，图片/图片组忽略）、「自动整理」（局部整理，与工具栏同一 handler）、「设置输出路径」、「删除所选」
- **任务中心下线**：删除 TaskCenter.tsx + TaskCenter.test.tsx，清掉 handleCancelTask / handleRetryFailed（无其他引用）；失败原因改由状态灯悬停 title + 画布右下角日志展示
- **新建/上传居中**：workflow.ts:canvasEntriesToNodes 增加可选 origin 参数，上传图片 / 历史导入传 getCreatePosition()（视口中心），不再落左上角 (40,40) 或视口外；新建卡片/图片组原本就走视口中心，行为不变
- **一屏全览**：minZoom 0.2 → 0.05；**移除 ReactFlow 初始 fitView prop**（空画布时被 React Flow 延迟到首节点出现才执行 → 新建/上传后视口突变放大，已实测复现），统一 fitCanvasToContent() 在自动整理/加载工作流/恢复存档后 fitView（minZoom 0.02）；Controls fitViewOptions 显式传 minZoom: 0.02，节点再多也能全览
- **放大预览缩放**：WorkflowModals.tsx ZoomModal 重写——滚轮以指针为锚缩放（pan' = p - (p - pan)·k 补偿，原生非被动监听）、指针捕获拖拽平移（dragging 状态驱动光标/禁用过渡）、clampPan 夹紧平移、双击复位、控制条（＋/－/百分比/适应窗口/1:1）、Esc 关闭
- **修复轮（E2E 实测驱动）**：① 初始 fitView 移除（见上）；② 新建/上传落点取消按节点总数级联偏移（节点一多越偏越远），getCreatePosition 改记忆最近落点阶梯错开，canvasEntriesToNodes 不再叠加偏移；③ 右键菜单屏蔽时序——Windows 上 contextmenu 在右键**松开后**才触发，mouseup 提前清 rightDownRef 会让拖出画布松开的菜单漏网，改由 window 捕获 handler 处理后清除；④ 预览点击关闭判定改 pointerdown（click 会被拖拽 pointer capture 重定向），图片本体/按钮不关闭其余空白关闭，图片区高度 calc(100vh-9rem) 防小屏溢出；⑤ Playwright E2E 9 项全过（新建/上传居中、视口不突变、右键屏蔽×2、预览开/关）
- **提示文字/文档同步**：画布底部操作帮助行、README「画布工作流」章节、ARCHITECTURE（目录结构/关键决策/测试表）、本文件
- **便携版打包下线**：删除仓库根 启动便携版.cmd 与 scripts/build-portable.ps1（用户判定为多余功能），README「零安装便携发布」段落、ARCHITECTURE「便携发布包」决策同步移除，scripts/ 目录清空删除

- **结构收敛轮（防同类 bug 复发）**：右键菜单屏蔽改【无状态】——window 捕获层一律屏蔽非输入区 contextmenu，删除 rightDownRef 时序标志（该时序正是"拖出画布弹菜单"的根源）；落点阶梯算法提为 workflow.ts:staggerCreatePosition 纯函数（+4 单测）；预览夹紧数学提为 previewZoom.ts:clampPreviewPan/clampZoom 纯函数（+5 单测）；E2E 脚本入库 frontend/e2e/verify_canvas.py（自包含测试图，9 项断言），README/ARCHITECTURE 补充运行说明

- **预览点击关闭再修复（放大态）**：zoom>1 时容器 pointerdown 无条件 stopPropagation+pointer capture，点击空白无法冒泡到 overlay（必须点容器外窄条才能关）——实测复现后改"位移阈值判定"：按下记录 moved/onImage，位移 >5px 才算拖拽平移，未移动且按在空白 = 点击 → 关闭；E2E 增补"放大后点图片边缘空白关闭"场景（10/10 全过）

### 关键实现细节

- handleRunSelected 的类型收窄用 "node is Extract<WorkflowNode, { type: "prompt" }>" 谓词（filter 回调内窄化不跨语句，直接 node.data.prompt 会 TS18046）
- ZoomModal 状态收敛为单一 view{zoom,pan}，所有更新走 clampPan 出口（含缩放后夹紧），避免平移/缩放状态分叉
- 光标 SVG 是 data URI，无法引用 CSS 变量，中心点固定蓝 #3b82f6；!important 保证覆盖 @xyflow/react 自带样式（依赖注入顺序不受控）

## 验证状态（2026-08-13）

| 检查 | 结果 |
| --- | --- |
| npx tsc --noEmit | 通过 |
| npm run lint | 通过（零告警） |
| npm test | 64 passed（7 文件；TaskCenter 用例随组件删除） |
| npm run build | 成功（dist 已更新） |
| 后端 | 零改动，无需回归 |

## 上一轮（2026-08-11，异步任务管线）

**前端生成管线改造：同步 `/api/generate` → 异步任务管线（提交 + 轮询 + 取消）**。状态：功能改造完成，全部验证通过，文档已同步。

### 后端（已完成，先行交付）

- `server.py`：`POST /api/generate` 改为提交即返回 `{ taskId, status }`；新增 `GET /api/tasks/{task_id}`（快照）、`POST /api/tasks/{task_id}/cancel`
- `core/tasks.py`：`TaskManager`（内存任务表 + `ThreadPoolExecutor` 并发池，`MAX_CONCURRENCY=10`，任务表上限 500，终态 TTL 600s 惰性清理）；`GenerationTask` 状态机 `queued → running → done/failed`，任意状态可取消 → `cancelled`
- 约束：必须单 worker 启动（uvicorn 不传 `--workers`，否则并发上限翻倍）；任务表纯内存（重启丢失，已提交任务仍后台完成但不再回流界面）；取消是逻辑取消（running 无法中断上游 requests，跑完当前张丢弃结果）

### 前端（本次完成）

- 删除 `frontend/src/generationQueue.ts` + `generationQueue.test.ts`
- `types.ts`：新增 `GenerationTaskStatus` / `GenerationTaskSnapshot`，删除 `GenerateResponse`
- `api.ts`：`generateImage` → `submitGenerate`（返回 `{taskId,status}`）；新增 `fetchTask` / `cancelTask`
- 新建 `frontend/src/useGenerationTask.ts`：统一提交-轮询 hook（`POLL_INTERVAL_MS=2000`，竞态防护用 pollTimersRef 比对 timer 引用；elapsed 本地计时每秒+1 以 startedAt 锚定；终态停止轮询但任务视图保留）；接口 `{ submit, cancel, get, tasks, subscribe }`，`subscribe(listener(taskId, view))` 返回取消函数；`GenerationTaskView = GenerationTaskSnapshot & { elapsed }`
- `App.tsx`（经典表单）：hook 驱动 busy/elapsed/日志/结果，删除 timerRef/setBusy
- `components/CanvasPage.tsx`（画布）：核心改造
  - 双映射 `nodeTaskRef`(nodeId→taskId，提交成功登记，终态解除) / `taskNodeRef`(taskId→nodeId，订阅定位)
  - `runNodeInternal` 重构为 submit 式（入边快照 → submit → 登记映射，双层守卫防重）；结果回流提取 `reflowResults(nodeId, task): Promise<number>`；新增 `waitCanvasIdle`（等 `nodeTaskRef.size === 0`）
  - 订阅 effect 驱动节点状态（queued/running/done/failed/cancelled），done 触发回流
  - `handleRunAll`：`await Promise.all(runnable.map(runNodeInternal))` 后 `waitCanvasIdle()`；日志改「服务端并发队列」；删除 `RUN_CONCURRENCY`
  - `cancelAllTasks` / `loadByName`（清映射）/ `handleDeleteNode`（取消关联任务）/ `handleRetryFailed` / `handleCancelTask` 均已适配
- `components/TaskCenter.tsx`：import 改 `../types`，`task.id` → `task.taskId`

## 验证状态

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | 通过 |
| `npm run lint` | 通过（1 warning 已加注释 + eslint-disable react-hooks/exhaustive-deps，订阅 effect 有意不依赖 generationTask 对象） |
| `npm test` | 35 passed（5 文件） |
| `pytest -q` | 109 passed |
| `npm run build` | 成功（dist JS 442.37 kB / gzip 141.71 kB） |
| `uv run ruff check .` | 通过（修了 test_server_tasks.py 未使用 import task_manager） |
| codegraph 残留核对 | `generateImage` / `generationQueue` / `GenerateResponse` / `createGenerationQueue` 零残留 |

## 已知问题

- `server.py:583` LSP 报 "Argument missing for parameter id" 是**误报**（`GenerationTask.id` 有 `default_factory`），pre-existing，非本次范围，勿修
- `useGenerationTask.ts` 无单元测试覆盖（codegraph ⚠️ no covering tests），后续可补
- `generate_image`（core/api.py:60）codegraph 标 ⚠️ no covering tests（pre-existing）

## 关键设计决策（新增，详细见 ARCHITECTURE.md）

- **提交即返回**：`/api/generate` 请求线程只做校验 + multipart 兜底文件落临时文件（路径存 task.temp_bases，执行线程只读路径，跨线程安全），真正生成在线程池，事件循环永不阻塞
- **经典表单与画布共用同一任务管线**（同一 TaskManager），全局并发 10 对所有窗口统一生效，谁先拿到空槽谁先跑
- **画布状态驱动**：节点状态不再由前端 queue worker 驱动，改由任务订阅回调驱动；`updatePromptNode` 对不存在节点安全（map 原样返回）
- 终态任务保留 10 分钟供轮询/展示，超时 404 由前端兜底标失败

## 文档同步状态

- [x] `ARCHITECTURE.md`：调用链、API 契约（+tasks 两行）、类型契约、数据流、关键决策（任务管线/状态机/防重复生成/画布并发）
- [x] `README.md`：画布「全部运行」服务端并发队列文案、状态灯守卫描述
- [x] 本文件（.omo/CONTEXT.md）
- [ ] （无遗留）

## 待办 / 下一步

- 无阻塞项。可选：补 `useGenerationTask` 单元测试；手动 UI 冒烟（多窗口并发、画布全部运行/取消/重试）

## 审查修复记录（2026-08-11，codegraph 深度审查）

- **修复 A：`runNodeInternal` 重复提交竞态**。旧 generationQueue 的守卫（queuedRef/runningRef）是**同步登记**，改造后 `nodeTaskRef.set` 在 `await generationTask.submit` 之后才登记，双击/快速连点会在 submit 完成前双双通过守卫 → 同一节点重复提交、结果双倍回流。修复：submit 前同步登记占位 `nodeTaskRef.set(nodeId, "")`，成功覆盖真实 taskId，失败清除；`handleDeleteNode` 的 `if (taskId)` 改为 `if (taskId !== undefined)` 以兼容占位值（占位时跳过取消仅清映射）
- **修复 B：App.tsx 订阅 effect 依赖整个 `generationTask` 对象**，hook 每次渲染返回新对象 → 每次任务状态刷新都重建订阅。已对齐 CanvasPage 约定只依赖稳定的 `generationTask.subscribe`（+eslint-disable 注释）
- **确认无回归**：经典表单旧版无取消按钮（git diff 验证），cancelled 分支是画布取消的响应
- **确认安全**：hook 轮询 timer 引用比对双重竞态防护、卸载清理定时器；后端 results 写回与状态置 done 由锁保证 happens-before；submit 后线程立即执行无竞态；`URLSearchParams` 解析 `?path=` 与 Python quote/前端 encodeURIComponent 互操作正确；poll 网络错误标 failed 是文档化取舍
- 修复后验证：tsc OK / lint exit=0 / npm test 35 passed
