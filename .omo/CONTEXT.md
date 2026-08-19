# 上下文交接文档（CONTEXT）

> 维护约定：本文件随工作进展持续更新，记录跨会话交接所需的关键事实——当前工作、架构决策、验证状态、已知问题。交接时先读这里。

## 当前工作（2026-08-13，画布拖拽添加：文件多图 + 工具栏按钮拖出）

**画布「拖拽添加」已统一：前端 tsc / lint / build 全绿、78 用例通过，E2E 26/26 PASS。**

- **文件拖拽多图**：拖本地图片（可多张）到画布任意位置松开即添加；**落点 = 鼠标松开处**（首个图片左上角，多图从落点向右排开 IMAGE_STEP=260）
- **工具栏按钮拖出**：新建提示词卡片 / 新建图片组可拖到画布任意位置松开即建（点击仍自动居中）；dataTransfer 自定义类型 `application/x-imagora-canvas`（值 prompt/group）；节点构建走 `workflow.ts:buildPromptNode/buildGroupNode`（与点击新建同一构建，默认参数收敛为 `promptNodeDefaults`）
- **落点示意统一**：跟随光标的小胶囊（portal 到 body + fixed，工具栏拖出可全局跟随），图标/文案按意图区分（图片数量 / 「松开新建提示词卡片」等）；位置由 JS 直接写 transform（高频 dragover 不触发 React 渲染）；胶囊偏移光标 22/28px（避免被拖拽虚影遮挡）
- **拖放接管整个工作区**（页面根，含工具栏/帮助栏）：UI 上不再出现浏览器禁止标志；落点在画布外夹紧到画布边缘（`dropPointFromEvent`）；意图判定带 `dropIntentRef` 回退（真实浏览器 dragover 阶段 getData 偶发为空）；弹窗打开时暂停接管
- **已知坑（已修复）**：dragover 阶段 `dataTransfer.files` 为空 → 数量从 `dataTransfer.items`（kind==="file"）统计；drop 前先判定拖拽意图，文本/无关拖拽放行（输入框原生行为不受影响）
- **可拖出按钮悬浮暗示**：grab 光标 + 品牌色呼吸光晕 + 右侧拖拽图标（`.btn-draggable`，index.css）
- **UI 微调**：工具栏按钮顺序（上传图片 · 粘贴导入 · 新建卡片 · 新建图片组 | 右侧不变）；底部帮助文字精简
- 顺带修复 pre-existing 债：`handleHistoryImport` 依赖缺 `getCreatePosition`（eslint warning）、E2E 文件 ruff（UP009/F401/PEP701）、ARCHITECTURE 9.2 编号重复
- 文档同步：README（入口 bullet）、ARCHITECTURE（5.4 / 5.6 / 8.3 / 9.2 新增 3/4 条 / 10.1 用例数 76→78 / 10.2 / 11.2）

## 已完成的代码改动（本轮）

| 文件 | 内容 |
|---|---|
| `frontend/src/workflow.ts` | `isImageFile`（MIME + 扩展名兜底）；`buildPromptNode` / `buildGroupNode`（点击/拖放共用构建） |
| `frontend/src/workflow.test.ts` | `isImageFile` 3 用例 + 节点构建器 2 用例（78 总计，原 73） |
| `frontend/src/index.css` | 画布光标重设计（细十字 + 白描边 + 中心品牌色加号）；落点示意（chip-in）；`.btn-draggable` 悬浮暗示（呼吸光晕 + 拖拽图标）；文件拖拽切 `copy` 光标 |
| `frontend/src/components/CanvasPage.tsx` | 落点示意统一机制（showDropChip/hideDropChip/positionDropChip，portal + transform 直写）；文件 + 工具栏拖拽四事件；`dropPointFromEvent` / `handleCanvasDropFiles` / `handleCanvasDropNode` / `handleToolbarDragStart`；ToolbarButton 支持 dragStart/dragEnd |
| `frontend/e2e/verify_canvas.py` | 第 8 节（文件拖拽）+ 第 9 节（工具栏拖出）：示意显隐/数量/跟随、落点精确、多图排开、非图片过滤、按钮拖起即显示、松开即建 |

## 历史工作（已提交，仅备忘）

- 多 profile 动态配置（config.json + core/config.py + /api/config 返回 baseUrl/defaultModel/activeProfile）：详情见 git 历史与 ARCHITECTURE 4.4、README「切换中转站」
- 上一轮技术债扫描结论：代码级零债（无 TODO/ts-ignore、pyflakes 零告警、严格 tsconfig、eslint-disable 均有正当注释）

## 验证状态（本轮）

| 检查 | 结果 |
|---|---|
| 前端 tsc / build | 通过 |
| 前端 lint | 零告警 |
| 前端 test | 78 passed（原 73 + 5） |
| 后端 ruff | `uv run ruff check .` 零告警 |
| E2E verify_canvas.py | **31/31 PASS**（含真实鼠标拖拽 3 条：原生 HTML5 DnD 管线 + 拖到 UI 区域落点夹紧画布顶边）；venv 已装 playwright + chromium headless |

> E2E 运行方式：起服务（`.venv\Scripts\python.exe -m main ui --no-browser --port 7860`）后另开终端 `.venv\Scripts\python.exe frontend\e2e\verify_canvas.py`。拖拽断言用 DataTransfer + DragEvent 模拟（文件内容用 `crypto.getRandomValues` 防注册表去重影响重复运行）。

## 已知问题

- `server.py:583` LSP 报 "Argument missing for parameter id" 是**误报**（`GenerationTask.id` 有 `default_factory`），pre-existing，勿修
- E2E 已用 Playwright 真实鼠标事件覆盖工具栏按钮的原生 HTML5 DnD；文件拖拽仍以合成 `DataTransfer` 模拟（OS 文件拖拽无法在 headless 复现），Windows 资源管理器拖文件建议人工体验一次

## 下一步

- 可选增强（非阻塞）：画布 Ctrl+V 粘贴图片（经典表单已有该能力，画布暂未接）；落点示意文案 i18n
