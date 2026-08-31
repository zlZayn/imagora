# frontend/ — React SPA（画布工作台 UI）

React 19 + TypeScript + Vite + Tailwind v4 + React Flow（`@xyflow/react`）。栈细节与设计决策见 [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 第 8 章。

## 本地常用命令（在本目录执行）

```powershell
npm install
npm run dev        # 开发模式（热更新；需后端已启动，见下）
npm run build      # tsc --noEmit + vite build → dist/（git 忽略，由后端服务托管）
npm test           # vitest run（165 用例）
npm run lint       # eslint
npx tsc --noEmit   # 类型检查
```

后端（任意终端，项目根目录）：

```powershell
.\.venv\Scripts\python.exe -m main ui --no-browser --port 7860
```

E2E（画布交互回归，真实浏览器；36 断言）：

```powershell
# 前置：7860 服务已在跑 + playwright 已装
#   .\.venv\Scripts\python.exe -m pip install playwright
#   .\.venv\Scripts\python.exe -m playwright install chromium
.\.venv\Scripts\python.exe ..\frontend\e2e\verify_canvas.py
```

## 该目录特有坑

- **契约双端同步**：后端改接口 → 必须同步 `src/api.ts` + `src/types.ts`（细节见 ARCHITECTURE 7.2）
- **UI 生效需重建**：改完代码 `npm run build`，否则浏览器拿到旧 `dist/`（dist 被 git 忽略，CI 必须自建）
- 动效/样式类统一收敛 `src/index.css`（`@layer components`），组件只引用类名；动画只动 transform/opacity
- 组件不改样式细节（引用类）；样式不写进组件文件（除了 Tailwind utility 类）
- 纯函数模块（src 根 *.ts）必须配同名 `*.test.ts` 单测；新纯函数进纯函数模块，不进组件

## 文件索引

### 契约与 API（改动需双端同步）

### [types.ts](src/types.ts)
- 职责：前后端契约类型全集（`AppConfig` / `GenerationTaskSnapshot` / `GenerateParams` / `ResultItem` / `AssetEntry` / `WorkflowNode` / `WorkflowEdge` …）
- 被谁依赖：全部 src 与 components
- 改后必测：`npx tsc --noEmit` + `npm test`；后端接口变更必须同步此处（ARCHITECTURE 7.2）

### [api.ts](src/api.ts)
- 职责：后端全部 API 封装（`getConfig` / `uploadRefs` / `submitGenerate` / `fetchTask` / `cancelTask` / `canvasUpload` / `workflowSave` / `generationHistory` / `importHistoryAsset` / `selectFolder` …）
- 被谁依赖：`App.tsx`、`CanvasPage.tsx`、`UploadZone.tsx`、`Gallery.tsx`、`HistoryGallery.tsx`
- 改后必测：`npm test`（若改类型）+ 对应 E2E
- 注意：与 `server.py` 路由一一对应；url 构造走后端返回，不在前端拼路径

### 纯函数模块（零 UI 依赖，全部有单测；改后跑 `npm test`，无需同步文档）

### [workflow.ts](src/workflow.ts)
- 职责：节点构建（`buildImageNode`/`buildPromptNode`/`buildGroupNode`）、动画类（`withEnterAnim`/`stripAnimClasses`）、连线约束（`canConnect` 纯函数：图片→提示词/图片组、图片组→提示词/**图片组**中转聚合、提示词→产出）、`computeCounts`（分组计数**递归**展开组链，防环）、落点阶梯（`staggerCreatePosition`）、`isImageFile`、`canvasEntriesToNodes`
- 被谁依赖：CanvasPage、CanvasNodes、PromptImportModal
- 注意：`CREATE_STAGGER_STEP`/`CREATE_STAGGER_RADIUS` 是落点阶梯常量

### [layout.ts](src/layout.ts)
- 职责：自动整理布局管道——`autoLayout`（全图）、`layoutSelection`（选中局部）、`layoutPromptResults`（结果回流排布）、`nodeSize`
- 被谁依赖：CanvasPage（自动整理/回流）
- 注意：局部整理不得漂移未选中节点（单测锁定）

### [canvasDrop.ts](src/canvasDrop.ts)
- 职责：拖拽意图解析（`resolveDropIntent`）、文件识别（`countDraggedFiles`/`extractImageFiles`）、落点示意文案（`dropChipLabel`）、画布内落点判定（`isInsideRect`）、常量 `CANVAS_DRAG_MIME`
- 被谁依赖：useCanvasDrop.tsx
- 注意：工具栏拖出画布外 = 取消（防错条 ARCHITECTURE 9.2.8）

### [previewZoom.ts](src/previewZoom.ts)
- 职责：预览缩放/平移数学（`clampZoom` / `clampPreviewPan` / `ZOOM_MIN..MAX`）
- 被谁依赖：WorkflowModals.tsx（ZoomModal）
- 注意：数学进纯函数，UI 不重算（ARCHITECTURE 9.5）

### [canvasHistory.ts](src/canvasHistory.ts)
- 职责：撤销/恢复栈（`createCanvasHistory`，limit=50）
- 被谁依赖：CanvasPage（undo/restore）

### [promptImportFormat.ts](src/promptImportFormat.ts)
- 职责：粘贴导入解析（`parsePromptImportFormat` 容错解析）、尺寸映射（`resolveCardSize`）、批量建卡（`buildPromptNodes`）
- 被谁依赖：PromptImportModal、CanvasPage
- 注意：格式规范见 ../docs/README.md；缺漏进 issues 标红，绝不静默猜测

### [recovery.ts](src/recovery.ts)
- 职责：恢复快照归一化（`buildRecoverySnapshot`，剥离动画类/运行期字段）
- 被谁依赖：useCanvasRecovery.ts

### [format.ts](src/format.ts)
- 职责：显示格式化（`formatBytes` / `generatingLabel` / `errMessage`）

### [logPath.ts](src/logPath.ts)
- 职责：日志文本路径词条解析（`splitLogPath`：本机绝对路径段 → 可点击复制词条；正反斜杠/单引号包裹/一行多路径）
- 被谁依赖：LogLine.tsx（经典表单日志区）
- 注意：后端生成消息的保存路径统一为绝对路径（server.py run_generation），前端解析展示，不再相对化

### [accent.ts](src/accent.ts)
- 职责：窗口主题色（`accentForWindow`，黄金角取色 → 覆盖 `--color-brand`）

### [windowInherit.ts](src/windowInherit.ts)
- 职责：新窗口继承（`saveInheritedState` / `readInheritedState` / `clearInheritedState`，sessionStorage）

### Hooks（组件级逻辑）

### [useCanvasDrop.tsx](src/useCanvasDrop.tsx)
- 职责：拖放接线（落点示意显隐/定位/文案、window 兜底守卫、工作区四事件）；提示词卡片/图片组拖出画布外松手取消
- 改后必测：`npm test` + E2E（verify_canvas.py 第 8-11 段）

### [useGenerationTask.ts](src/useGenerationTask.ts)
- 职责：生成任务轮询/取消（`useGenerationTask`）
- 注意：返回稳定成员引用（hook 单测锁定）

### [useCanvasRecovery.ts](src/useCanvasRecovery.ts)
- 职责：恢复快照自动保存/恢复接线

### [useImageZoom.ts](src/useImageZoom.ts)
- 职责：图片「单击开原图 / 双击放大预览」时序区分（`useImageZoom`，250ms 延时）
- 被谁依赖：Gallery.tsx（经典表单结果图）、HistoryGallery.tsx（生产历史）
- 注意：双击第二击必须取消未决的单击开窗（防连开两个新标签，单测锁定）

### 组件（components/；改后跑 `npm test` + E2E）

- [`CanvasPage.tsx`](src/components/CanvasPage.tsx) — 无限画布主页面（React Flow 集成、选中操作栏、历史面板入口）
- [`CanvasNodes.tsx`](src/components/CanvasNodes.tsx) — 三类节点（图片/图片组/提示词卡）+ `ActionButton`（nodrag 胶囊按钮）；`StatusLight` 状态灯 running 恒定「生成中」，`ElapsedText` 秒数文字以 `startedAtMs` 自计时（防逐秒重渲染，见 ARCHITECTURE 5.3）
- [`WorkflowModals.tsx`](src/components/WorkflowModals.tsx) — 保存/加载/导入弹窗 + **`ZoomModal` 全屏预览**（createPortal 到 body，画布 / 经典表单 / 生产历史共用；Portal 根截停 click 冒泡，防误关外层宿主遮罩）
- [`ResultPanel.tsx`](src/components/ResultPanel.tsx) — 经典表单结果区 5 态容器：主图形层 absolute 居中钉死 + 副信息层底部独立生长（行增减不挤动主图形）；切换交叉淡化（swap-in/swap-out，旧层保留 200ms）；排队/生成中/失败/已取消/透传 Gallery；生成中图标本体按自身颜色呼吸光（`icon-breathe`）
- [`Gallery.tsx`](src/components/Gallery.tsx) — 经典表单结果图（双击放大 / 单击新窗口开原图，250ms 区分，走 useImageZoom；被 ResultPanel 透传）
- [`LogLine.tsx`](src/components/LogLine.tsx) — 日志单行：文本里的本机绝对路径拆成可点击复制词条（CopyChip），其余保持文本；行动画 log-line
- [`CopyChip.tsx`](src/components/CopyChip.tsx) — 路径词条：点击复制完整路径（`navigator.clipboard`），复制后边框/底色高亮反馈 1.2s（不换文字，避免宽度跳动）
- [`UploadZone.tsx`](src/components/UploadZone.tsx) — 参考图上传区（缩略图单击不触发文件选择器、双击放大）
- [`HistoryGallery.tsx`](src/components/HistoryGallery.tsx) — 生成历史面板：**分页滚动加载**（首屏 60 条，滚动接近底部 600px 内自动追加、未占满视口自动续拉，按钮仅兜底，DOM 恒在单页数量级）两栏网格卡片（160px 结果图 | 提示词 2 行截断随容器宽 | 56px 参考图换行 | 按钮底部对齐横排）；提示词超 2 行时悬浮浮层补全（仅截断弹、宽固定 80vw 水平居中左/右各留 10vw、高随行数自动长、垂直跟随鼠标、无滚动条）；搜索/状态筛选重置到第 0 页；双击放大预览 / 单击新窗口开原图 / 导入当前画布
- [`PromptImportModal.tsx`](src/components/PromptImportModal.tsx) — 粘贴导入弹窗（实时解析 + 问题标红）
- [`FolderPicker.tsx`](src/components/FolderPicker.tsx) / [`Select.tsx`](src/components/Select.tsx) — 目录选择 / 尺寸质量下拉

### 根文件

- [`App.tsx`](src/App.tsx) — 根组件：顶栏（品牌区 3D `brand-swing` 系、窗口徽章）、经典/画布模式切换。品牌区参数（`BRAND_LAYERS`/`BRAND_DEPTH`/`LOGO_FACE*`）与局部样式在 App.tsx 顶部
- [`main.tsx`](src/main.tsx) — 入口（挂载 + accent 主题注入）
- [`index.css`](src/index.css) — **唯一样式层**：Tailwind v4 + `@layer components` 组件类（btn 体系/panel-card/动效类）+ 品牌区 3D + 落点示意等；改样式只改这里（含 `pulse-glow` 圆环呼吸 / `icon-breathe` 图标本体呼吸光）
- [`verify_canvas.py`](e2e/verify_canvas.py) — 画布交互 E2E（36 断言，Playwright headless）

## 上下游依赖

### 本目录用到了谁
- 后端：`server.py` 全部 `/api/*`（经 api.ts 封装）+ `core/registry.py` 的 `image_url` 约定（url 由后端返回）
- 第三方：`@xyflow/react`、`lucide-react`、`react` 19

### 谁用到了本目录
- `server.py`：托管 `dist/` 构建产物（静态文件）
- `tests/`：无（前端测试在本目录内）
- CI：Frontend Job（npm ci/test/build）、E2E Job（自建 dist）

## 变更影响路由（改前必看）

- 改后端接口（server.py）
  → 同步 `api.ts` + `types.ts`
  → 跑 `npm test` + `npm run build`
  → 同步 ARCHITECTURE 7.1 表

- 改纯函数（src 根 *.ts）
  → 跑 `npm test`（有单测即够，无需文档）

- 改组件（components/）
  → 跑 `npm test` + E2E（画布相关必跑 verify_canvas.py）
  → 如改样式 → 进 `index.css` 组件类

- 改 `index.css`
  → `npm run build`（Tailwind v4 编译）
  → 相关组件 E2E 复验（按钮/品牌区/落点示意有专项断言）

- 改 `App.tsx` 品牌区/顶栏
  → 跑 build + E2E（品牌区断言）+ 本地目验摆动

## 参考

- 设计决策（动画约束/按钮体系/品牌区 3D/预览统一）：[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 8.4 / 9.4
- E2E 与测试命令：[../tests/README.md](../tests/README.md)
- 维护仪表盘（数字/待办/坑）：[../AGENTS.md](../AGENTS.md)