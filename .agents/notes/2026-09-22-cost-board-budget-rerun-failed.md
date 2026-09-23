# 决策：成本看板 + 预算保护 + 重跑失败项（2026-09-22）

已实施：shipped

## 问题

本机账本 556 行里 266 行失败（48%），集中在 8-15~8-17 上游不稳期；成功后中位耗时 190.9s、失败中位仅 16.4s。
痛点有两个：① 失败只能靠人工照着历史重新提交，批量补跑没有入口；② 花费只有逐条记录，缺总览，批量提交前无法预估、没有上限护栏。
同时发现：账本 `outputAssetIds`/`inputAssetIds` 只有最近几条有值，早于「提交时登记参考图」机制的历史失败记录**参考图无法找回**。

## 决策

### 1. 统计口径用**账本原始行**（不去重、不截断）

`core/history.py` 新增 `read_raw_history()`：列表展示口径（同参数聚合 + 500 原始行上限）面向"看记录"，而计费口径必须逐行——每个成功行都真实花过钱，聚合会少算费用。
新增 `core/cost.py` 承担聚合与预算判定，`/api/history/stats` 与 `/api/budget/check` 都走原始行。

### 2. 预算语义是「超限需确认」而非硬拦

`check_budget(estimate, settings, spent_today, confirmed)`：`singleRunLimit`/`dailyLimit`（0 = 不限）任一超限即 `over=True`，只要 `confirmed=True` 就放行。
前端弹窗写明「今日已花 + 本次预估 vs 预算」，确认后才带 `allowOverBudget` 重新提交；服务端闸门对 `/api/generate` 与 `/api/generate/batch` 同样生效（409 + 结构化 detail），多窗口并发也不会漏拦。
预算落在 `output/.budget.json`（随 output/ 一起 git 忽略）——**不进公开仓库**，也不动 `config.json` 的 profile 键白名单（避免为本地偏好污染公共配置）。

### 3. 重跑走「批量提交」而不是「在画布上建卡」

`POST /api/generate/batch`：一次提交多条，单条非法只跳过该条（批量要能部分成功）；全部非法或超预算未确认则一条都不提交（避免"提交一半被拦"）。
前端在确认弹窗里展示条数、预估费用、预算状态、**不可重跑原因聚合**、输出目录（可改），提交后逐任务轮询 `重跑中 x/y`，完成后刷新列表与看板。

候选筛选与参数构造是纯函数（`frontend/src/rerun.ts`）：失败记录 + 有提示词/尺寸/质量 + 图生图记录的参考图仍能从 `.assets` 解析出路径。
**参考图找不回时明确跳过并报因（`RERUN_LOST_REFS`），绝不静默降级成文生图**——降级会产出与用户预期不符的图，比不跑更糟。

### 4. 单张提交也要有确认路径（不只是批量）

服务端闸门对 `/api/generate` 同样生效，所以经典表单 / 画布节点 / 「全部运行」在超预算时会拿到 409。
`useGenerationTask.submit` 是所有提交的唯一入口（App 与 CanvasPage 共用同一个 hook 实例），在这里做兜底确认：
409 → 用 `/api/budget/check` 取人话原因 → 原生 confirm → 确认后带 `allowOverBudget` 重提。
`overBudgetConfirmedRef` 按 hook 实例记忆"本次会话已确认"——「全部运行」连续提交多条只问一次，不连问 N 次；取消则原样抛出 409。
（历史面板的批量重跑不走这里：它有样式化确认弹窗，会在弹窗里直接带标记提交。）

## 替代方案（否决原因）

- **在画布上为每条失败记录建提示词卡 + 图片节点 + 连线再运行**：能复用「结果回流」链路，但批量 30 条会把画布塞满、破坏用户已有工作流；且本机 12 个工作流已 132 张图，画布不是重跑这类"批量补跑"的合适容器。改为结果落输出目录 + 进历史，需要时再「导入当前画布」。
- **统计走聚合口径复用 `/api/history`**：少一次读盘，但会少算费用（同参数多次成功只留最新一条），与"计费"用途直接冲突。
- **预算做成硬上限（超限直接 400）**：误配一次预算就把正常工作拦死；改为确认制，风险由用户显式承担。
- **预算设置进 `config.json`**：那是 git 跟踪的公共配置，个人预算属于本机偏好，且新增 profile 键要同步白名单与测试，代价与收益不匹配。

## 影响

- 新增依赖关系：`server.py → core/cost.py → core/config.cost_for_size`（价格唯一来源仍是 config.json，无硬编码）
- 新增文件：`core/cost.py`、`frontend/src/cost.ts`、`frontend/src/rerun.ts`、`frontend/src/components/CostBoard.tsx`、`output/.budget.json`（运行时生成，git 忽略）
- 测试：后端 222 → **258**（`test_core_cost.py` 21 + `test_server_cost.py` 15），前端 169 → **193**（`cost.test.ts` 6 + `rerun.test.ts` 9 + `HistoryGallery.test.tsx` +5 + `useGenerationTask.test.ts` +4）；`scripts/check_docs.py` 通过（192 链接 + 双端计数一致）
- 契约：ARCHITECTURE 7.1 增补 4 个路由 + `/api/generate` 的 `allow_over_budget`；7.2 增补历史/成本类型
- 实测（本机真实账本）：累计 21.90 元、成功率 52.2%、成功平均 188.4s、1152x2048 用了 14.80 元；**当前 266 条失败记录里可重跑数为 0**（参考图未登记，界面显示「参考图已丢失」并禁用按钮）——功能对今后的失败生效
