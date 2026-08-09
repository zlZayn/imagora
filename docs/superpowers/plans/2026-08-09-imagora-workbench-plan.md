# Imagora Workbench Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在稳定画布底座上增加任务中心、历史图库、撤销重做、启动检查和更清晰的生产工作台界面。

**Architecture:** 后端只提供本地历史记录和启动状态的只读 API；前端继续保留 React Flow，将控制器、视口、工具栏和任务面板拆开。所有增强功能建立在第一阶段的 `generationQueue` 与恢复快照之上。

**Tech Stack:** FastAPI、pytest、React 19、TypeScript、Vitest、@xyflow/react、Playwright 浏览器检查

---

## 文件结构

- Create: `core/history.py` - 安全读取 generation.jsonl。
- Create: `tests/test_core_history.py` - 损坏行、筛选和排序测试。
- Modify: `server.py` - 历史与启动状态 API。
- Create: `frontend/src/history.ts` - 历史 API 类型和筛选。
- Create: `frontend/src/components/TaskCenter.tsx` - 队列状态、取消、重试。
- Create: `frontend/src/components/HistoryGallery.tsx` - 搜索、时间筛选、定位和导入画布。
- Create: `frontend/src/canvasHistory.ts` - 撤销/重做纯状态历史。
- Create: `frontend/src/canvasHistory.test.ts` - 历史边界测试。
- Create: `frontend/src/components/CanvasShell.tsx` - 页面布局和工具栏。
- Create: `frontend/src/components/CanvasViewport.tsx` - React Flow 视口。
- Create: `frontend/src/useCanvasController.ts` - 节点/边/选择/高亮控制器。
- Modify: `frontend/src/components/CanvasPage.tsx` - 只负责组合模块。
- Modify: `frontend/src/index.css` - 工作台状态与响应式样式。

### Task 1: 生成历史 API

- [ ] 写失败测试：JSONL 损坏行跳过、最新优先、prompt/quality/status 搜索。
- [ ] Run: `uv run pytest tests/test_core_history.py -q`，确认模块不存在而失败。
- [ ] 实现 `read_generation_history(limit=200, query="", status="")`，逐行解析且不返回密钥。
- [ ] 增加 `GET /api/history`，参数限制 `limit <= 500`。
- [ ] Run: `uv run pytest tests/test_core_history.py -q`，确认通过。
- [ ] Commit: `feat: expose safe generation history`。

### Task 2: 任务中心

- [ ] 为 `generationQueue` 增加快照 selector 测试，确保取消和 retryFailed 只影响目标任务。
- [ ] 创建 `TaskCenter.tsx`，固定显示 queued/running/failed 数量；失败项提供重试，排队/运行项提供取消。
- [ ] 在画布工具栏右侧挂载任务中心，不改变节点卡片尺寸。
- [ ] Run: `npm test -- generationQueue.test.ts && npm run build`。
- [ ] Commit: `feat: add canvas task center`。

### Task 3: 历史图库

- [ ] 写 `history.test.ts`，覆盖关键词、时间和状态筛选。
- [ ] 创建虚拟化前预留的固定比例网格；首版最多请求 200 条，图片使用 `loading="lazy"`。
- [ ] 每项支持打开文件夹、复制提示词、导入当前画布；不提供危险的批量删除。
- [ ] Run: `npm test -- history.test.ts && npm run build`。
- [ ] Commit: `feat: add searchable generation history`。

### Task 4: 撤销与重做

- [ ] 写失败测试：节点移动、连接、删除、自动整理可撤销；运行状态和 elapsed 更新不进入历史。
- [ ] 实现上限 50 的 `createCanvasHistory`，提供 `push/undo/redo/canUndo/canRedo`。
- [ ] 接入控制器，并为工具栏增加图标按钮和禁用状态。
- [ ] Run: `npm test -- canvasHistory.test.ts && npm run build`。
- [ ] Commit: `feat: add canvas undo and redo`。

### Task 5: 画布组件拆分

- [ ] 建立 `useCanvasController`，统一 nodes/edges/selection/highlight 与业务事件。
- [ ] 将 React Flow 渲染移动到 `CanvasViewport`，只接收状态和回调 props。
- [ ] 将工具栏、日志、弹窗和侧栏移动到 `CanvasShell`。
- [ ] 将 `CanvasPage.tsx` 缩减为模块装配和 API 依赖注入，不保留第二套 refs 状态。
- [ ] Run: `npm test && npm run build`。
- [ ] Commit: `refactor: split canvas workbench modules`。

### Task 6: 启动检查与界面验收

- [ ] 为启动状态写后端测试：API Key、dist、输出目录可写、当前端口信息。
- [ ] 增加 `GET /api/health/details`，只返回布尔值和可读原因，不返回路径中的敏感内容或密钥。
- [ ] 前端初始化失败时显示明确操作提示，不进入空白画布。
- [ ] 启动本地服务，使用浏览器检查 1440x900 与 900x700：工具栏不重叠、节点文字不溢出、历史图库可滚动、任务中心可操作。
- [ ] Run: `uv run pytest -q`、`npm test`、`npm run build`。
- [ ] Commit: `feat: finish reliable Imagora workbench`。

