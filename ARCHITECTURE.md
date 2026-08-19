# Imagora 架构说明

> 本文档面向持续开发者：描述系统结构、模块关系、关键决策与**防错规范**。
> 阅读建议：改后端先读第 4、6 章；改画布先读第 5、9 章；新功能落地前通读第 11 章变更守则。

## 1. 系统概览

### 1.1 三层结构

Imagora 是本地单机工具，运行时分三层，方向单一：

1. **浏览器**（React SPA）：全部界面逻辑在 `frontend/`，通过相对路径 `fetch /api/*` 与后端通信，不写死主机名。
2. **服务端**（FastAPI，`server.py` + `core/`）：既提供 `/api/*` 路由，也在同一端口托管 `frontend/dist` 静态产物——单端口，浏览器访问 `http://127.0.0.1:7860` 即得全部。
3. **上游生图 API**（OpenAI 兼容接口）：服务端唯一的外部依赖，仅在 `core/api.py` 中调用；网络失败、超时、计费错误都在这层收敛为可读错误。

依赖方向只有一条链：浏览器只认识服务端，服务端只通过 `core/api.py` 认识上游。任何模块不得绕过这层直接发请求。

### 1.2 设计哲学

- **配置分离**：公开配置（中转站地址/模型/尺寸/质量）在 `config.json`（git 跟踪、多 profile）；密钥只在 `.env` / 环境变量（git 忽略）；`core/config.py` 是唯一加载层，代码中不出现明文密钥。
- **职责单一**：一个模块一个职责——config 管配置、api 管上游请求、tasks 管异步任务、canvas 管画布存储、logging 管日志、server 只做路由薄层、frontend 管界面。
- **产物与代码分离**：生成图片、参考图缓存、画布图片、工作流文件全部落在 `output/`（git 忽略），不进代码库。
- **按名管理**：每个产品一个目录，素材/批量配置/输出随产品走；工具代码跨产品共享。
- **类型安全**：前端 TypeScript 严格模式，前后端类型契约集中在 `frontend/src/types.ts`，与后端返回结构一一对应。
- **路径可迁移**：所有路径以 `WORK_ROOT`（进程启动时 `Path.cwd()` 固定）或配置文件所在目录为基准，不硬编码绝对路径；项目文件夹改名/移动后旧数据依然可恢复。

### 1.3 全局不变量

- 端口唯一真相源：服务是否在跑、进程是谁，一律以 `netstat` 探测端口监听者为准，不信任任何落盘状态文件。
- 任务管线唯一：经典表单与画布共用同一个 `TaskManager`，全局并发上限对所有窗口统一生效。
- 图片三源归一：本地上传 / 输出目录导入 / 生成结果回流，最终都复制进 `output/.canvas/` 注册表管理。
- 单 worker 启动：uvicorn 不得传 `--workers`，否则任务并发上限翻倍、窗口计数器错乱。
- 前端静态资源 no-cache：中间件统一 `Cache-Control: no-cache`，本地迭代改完前端刷新即生效。

## 2. 目录与模块

### 2.1 仓库根

| 路径 | 职责 |
| --- | --- |
| `main.py` | CLI 入口：`ui` / `menu` / `batch` / `gen` 四个子命令 |
| `server.py` | FastAPI 应用：全部 `/api/*` 路由 + 托管 `frontend/dist` |
| `启动生图工作台.cmd` | 开发环境双击入口：构建检查 → 起服务 → 开窗 → 进入交互菜单 |
| `config.json` | 公开配置（git 跟踪）：多 profile（中转站/模型/尺寸/质量/ratios），`default_profile` 指定公共默认 |
| `core/` | 后端核心逻辑（见 2.2），全部无 HTTP 依赖的纯业务模块 |
| `frontend/` | React SPA（见 2.3） |
| `tests/` | 后端 pytest（113 用例，纯函数 + 路由，不调上游） |
| `docs/` | `prompt-contract.md`：提示词契约模板（发给多模态模型的输出格式规范） |
| `logs/` | 生成日志 `generation.jsonl`（git 忽略） |
| `output/` | 全部运行产物（git 忽略）：`win{N}` 窗口分区、`.refs` 参考图缓存、`.canvas` 画布图片与注册表、`workflows` 工作流 |

### 2.2 后端 core/ 模块

- `config.py` —— 配置中心：API Key、BASE_URL、尺寸/质量选项、RATIOS、默认参数。**全后端唯一配置源**，其他模块从这里读，不自行读环境变量。
- `api.py` —— 上游请求封装：`generate_image`（文生图/图生图一次请求）、尺寸解析、错误格式化。依赖 config 与 console。
- `tasks.py` —— 异步任务管线：`TaskManager` 提交登记、线程池并发执行、快照查询、取消、TTL 清理。
- `canvas.py` —— 画布存储：图片注册表（内容去重、原子写）、工作流 JSON 存取、恢复快照。纯逻辑，无 HTTP。
- `history.py` —— 生成历史 JSONL 读取。依赖 logging 的日志目录常量，无 HTTP。
- `logging.py` —— 生成日志统一写入（线程锁串行追加），UI/批量/CLI 三路共用。
- `console.py` —— rich 终端输出（成功/失败/信息配色、进度条、面板），无业务依赖，可被任意模块引用。

### 2.3 前端 src/ 模块

- `main.tsx` / `App.tsx` —— 入口与双模式外壳：经典表单 / 无限画布切换（`?mode=canvas` 直达），多窗口编号与主题色。
- `api.ts` —— `/api/*` 请求封装，全部返回类型化。
- `types.ts` —— 前后端类型契约（AppConfig / 任务快照 / 节点 / 边）。
- `useGenerationTask.ts` —— 提交-轮询任务 hook：经典表单与画布共用，`submit/cancel/get/tasks/subscribe` 五个稳定成员。
- `useCanvasRecovery.ts` —— 画布恢复：挂载时询问是否恢复最近存档，防抖自动保存。
- `useCanvasDrop.tsx` —— 画布拖拽接线 hook（文件多图 / 工具栏按钮拖出共用）：落点示意显隐/定位/文案、拖放意图解析、window 级兜底守卫、工作区四事件；节点怎么建由回调上抛（onDropFiles/onDropNode），本 hook 不含业务。
- 纯函数模块（零 UI 依赖，全部有单测）：`workflow.ts`（节点工具/动画类/布局/连线/节点构建器）、`canvasDrop.ts`（拖拽意图解析/文件识别/落点示意文案）、`promptContract.ts`（契约解析/尺寸映射/建卡）、`canvasHistory.ts`（撤销栈）、`recovery.ts`（快照归一化）、`previewZoom.ts`（预览缩放数学）、`format.ts`、`accent.ts`、`windowInherit.ts`。
- `components/`：`CanvasPage.tsx`（画布状态中枢 + 工具栏 + ReactFlow）、`CanvasNodes.tsx`（三类节点组件）、`WorkflowModals.tsx`（保存/加载/放大预览弹窗）、`PromptImportModal.tsx`、`HistoryGallery.tsx`、`UploadZone.tsx`、`Gallery.tsx`、`Select.tsx`、`FolderPicker.tsx`。

### 2.4 依赖规则

后端：`main.py` / `server.py` / `core/batch.py` 调用 `core/api.py`；`core/api.py` 依赖 `core/config.py` 与 `core/console.py`；`core/canvas.py` 与 `core/history.py` 是纯逻辑模块（无 HTTP），由 server 路由薄层调用；`core/tasks.py` 是任务管线，server 的 `/api/generate` 只做校验与登记；`main.py` 的 `menu` 子命令通过 HTTP 接口（`/api/status`、`/api/window/next`）感知服务状态。

前端：`CanvasPage.tsx` 编排一切画布行为；节点组件（`CanvasNodes.tsx`）只负责展示与上抛事件，不持有画布状态；纯函数模块零依赖、可独立单测。

**铁律：不存在反向/循环依赖。**新模块只允许依赖下层（纯函数层 → 组件层 → 页面层），出现反向引用即重构信号。

## 3. 启动与运行

### 3.1 CLI 子命令（`uv run python -m main <子命令>`）

| 子命令 | 用途 | 关键参数 |
| --- | --- | --- |
| `ui` | 启动网页界面（FastAPI + 托管前端） | `--port`（默认 7860）、`--no-browser`（外部脚本控制开窗时用） |
| `menu` | rich 交互菜单 | `--port`；N 开新窗口 / Q（或 Ctrl+C、点 X 关窗）退出并连根停止服务 |
| `batch` | 批量生图 | `--config`、`--only`、`--dry-run`（预览不花钱） |
| `gen` | 单张生图 | `prompt`、`-i` 参考图、`-o` 输出、`--ratio/--size/--tier/--quality/--model/--n/--format` |

### 3.2 启动脚本三段流程（`启动生图工作台.cmd`）

脚本是日常入口，按顺序完成三件事：

1. **前端构建状态检查**：比对 `frontend/src` 最新修改时间与 `frontend/dist/index.html`，输出 NOT_BUILT / STALE / OK；前两种情况询问是否现场构建（`npm install && npm run build`）。
2. **服务状态检查**：`netstat` 探测端口监听者——已在运行则跳过启动（直接进入第 3 步）；否则后台启动 `uv run python -m main ui --no-browser`（同控制台，关窗即停服），并轮询 `/api/config` 直到 200（最长 30 秒）。
3. **开窗并进入菜单**：`/api/window/next` 取窗口编号 → 打开首窗 → 进入 `menu` 子命令。

### 3.3 交互菜单与进程生命周期

菜单的服务状态**实时动态探测**：进程 PID 用 netstat 找端口监听者（端口是唯一真相源，兼容 IPv4/IPv6 双栈）；窗口编号读 `/api/status` 的服务端计数器（只读，不落盘）。

**关闭就关全部**：Q 退出（主循环 finally）、Ctrl+C（SIGINT）、点窗口 X（`SetConsoleCtrlHandler` 捕获 CTRL_CLOSE_EVENT）三条路径都收敛到 `stop_port_services(port)`。它先收集端口上全部监听 PID，再沿 ParentProcessId 逐级回溯到根（覆盖 uv → python shim → python 的多层包装），从根开始逐个 `taskkill /f /t`——既杀监听层也杀宿主进程，避免「端口释放了但进程残留」。这同时实现了「本次关闭时所有窗口一起失效」，且不依赖会被多开脚本互相覆盖的 PID 文件。

## 4. 后端架构

### 4.1 任务管线（TaskManager，`core/tasks.py`）

生成走异步管线，`/api/generate` **提交即返回**：请求线程只做校验与 multipart 兜底文件落盘（临时文件路径存入任务对象，执行线程只读路径，跨线程安全），真正生成在 `ThreadPoolExecutor`（MAX_CONCURRENCY=10）中执行。

状态机：`queued → running → done/failed`，任意状态可取消 → `cancelled`（运行中无法中断上游请求，跑完当前张丢弃结果）。终态保留 10 分钟（TTL 惰性清理），超时查询返回 404，由前端兜底标失败。

约束：任务表纯内存（重启丢失，已提交任务仍会在后台完成但不再回流界面）；必须单 worker 启动。

### 4.2 server.py 路由薄层原则

路由只做三件事：解析请求 → 调用 core 模块 → 组装响应。业务逻辑不进路由；core 模块不依赖 HTTP。新增接口时：先在 `core/` 放纯逻辑 + 在 `tests/test_*` 补用例，再在 server 加薄路由。

### 4.3 路径与安全

参考图路径白名单：`/api/generate` 的 `ref_paths` 只接受 `output/.refs/` 与 `output/.canvas/` 两个目录内的路径（逐根 commonpath 校验，跨盘 root 单独捕获不误伤），防路径穿越；与 `images` multipart 互斥、`ref_paths` 优先——图生图不二次上传大图。

### 4.4 配置加载层

配置分层（优先级从高到低）：环境变量（含 `.env` 自动加载，已存在的环境变量不被覆盖）→ `config.json` 的 `profiles[ACTIVE_PROFILE]` → `config.json` 的 `default_profile` → 内置默认值。

- `ACTIVE_PROFILE` 选择来源：`.env` / 环境变量（本机临时覆盖）> `config.json` 的 `default_profile`（git 跟踪的公共默认）。
- profile 解析是**纯函数**（`resolve_profile_config` / `unknown_profile_keys`，有单测）：profile 缺失 / JSON 格式错 / 未知键 → 控制台警告并回退，绝不静默。
- **密钥跟随 profile**：`get_api_key()` 按 `API_KEY_<PROFILE 大写>` → `API_KEY` → `AIWANWU_API_KEY`（旧写法兼容）逐级查找，切换中转站 key 自动跟随。
- **铁律**：密钥只允许在 `.env` / 环境变量；`config.json` 是公开配置（git 跟踪），绝不放密钥。

### 4.5 错误处理与日志

统一 `core/api.py:format_error(e, limit)` 输出「类型: 消息」截断，UI 与命令行共用。每次生成（UI/批量/CLI）由 `core/logging.py` 写入 `logs/generation.jsonl`（线程锁串行），字段：时间/模式/参考图数/提示词/尺寸/质量/结果/费用/耗时/输出路径/窗口号。

## 5. 前端架构

### 5.1 双模式

`App.tsx` 持有经典表单的全部状态（提示词/参考图/尺寸/质量/输出路径/任务状态）；画布模式首次进入后**保持挂载**（切换模式只显隐，内容保留，退出窗口才清空）。两种模式共用同一任务管线。

### 5.2 画布核心模型

React Flow v12（`@xyflow/react`）受控模式：`nodes` / `edges` 状态由 `CanvasPage` 持有，`useNodesState` / `useEdgesState` 管理变更。

三类节点（`CanvasNodes.tsx`）：

- **图片节点**：缩略图 + 引用计数，顶部 target 接生成结果，底部 source 输出参考图。
- **图片组节点**：聚合多图统一连入提示词。
- **提示词节点**：提示词/尺寸/质量/输出路径/运行按钮 + 状态灯，固定宽 380px。

连线硬约束（`isValidConnection`）：图片 → 提示词/图片组、图片组 → 提示词、提示词 → 图片（产出边）；提示词顶部仅允许一条入边，多图经图片组聚合。连线方向即参考关系：图片连到提示词 = 该图作为此任务的参考图。

### 5.3 任务驱动模型

每个提示词节点是独立任务，无全局启动节点。提交时 `runNodeInternal` 先**锁定入边参考图快照**（`collectIncomingImages` 纯函数，图片组递归展开、visited 防环），随后 `submitGenerationTask` 提交，映射 nodeId → taskId 登记；订阅回调按 taskId → nodeId 反查驱动节点状态（queued/running/done/failed/cancelled）。

防重复生成：双层守卫——节点 `data.status` + `nodeTaskRef` 映射，提交前同步登记占位（防快速连点竞态），终态解除映射，删节点/加载工作流时同步清理。

### 5.4 画布交互层

- **拖拽添加（文件 / 工具栏按钮，共用同一落点示意）**：拖本地图片（可多张）到画布任意位置松开即添加，或把「新建提示词卡片 / 新建图片组」按钮拖出到画布松开即建（点击仍自动居中）。接线统一收敛在 `useCanvasDrop` hook（意图解析/落点换算/示意/守卫），纯逻辑在 `canvasDrop.ts`，节点构建在 `workflow.ts:buildPromptNode/buildGroupNode`（与点击新建同一构建）。落点 = **鼠标松开处**（`screenToFlowPosition` 换算），批次内沿用 `canvasEntriesToNodes` 横向排开；文件走 `isImageFile` 过滤 + `POST /api/canvas/upload`，工具栏拖走自定义 dataTransfer 类型（`application/x-imagora-canvas`，值 prompt/group）。
  - **落点示意**：跟随光标的小胶囊（portal 到 body + fixed 定位，工具栏拖出可全局跟随），图标/文案按意图区分（图片数量 / 「松开新建提示词卡片」等）；位置由 JS 直接写外层 transform（高频 dragover 不触发 React 渲染）、数量从 `dataTransfer.items`（kind==="file"）统计——**dragover 阶段 `dataTransfer.files` 为空**（浏览器延迟到 drop 才填充）；拖入时画布切系统 `copy` 光标（`.canvas-drop-active`）。
  - **防护**：dragenter/leave 计数平衡防闪烁（仅文件拖拽）；拖放接管挂在**整个工作区**（含工具栏/帮助栏），UI 上不出现浏览器禁止标志，落点在画布外先夹紧到画布边缘（`dropPointFromEvent`）；意图判定带 `dropIntentRef` 回退（真实浏览器 dragover 阶段 getData 偶发为空）；窗口级只拦截携带 Files 的拖拽（防落画布外触发浏览器打开文件导航）；`dragend`/失焦复位拖拽状态；drop 前先判定意图，文本/其他拖拽**放行**（输入框原生行为不受影响）；弹窗打开时暂停接管。
- **右键拖拽框选**：右键按下→拖拽→松开，起点/终点用 `screenToFlowPosition` 换算，松开时按「节点完全包含于选框」落定选中；`mouseup` 挂 window（画布外松开也生效）。
- **右键菜单屏蔽**：window 捕获层**无状态**屏蔽非输入区 contextmenu（文本框/输入框保留原生菜单），不依赖任何时序标志。
- **选中操作栏**：任意选中 ≥1 个节点后右上角出现——运行所选（只跑提示词卡片）/ 自动整理（局部重排）/ 设置输出路径 / 删除所选。样式为**半透明毛玻璃**（bg-white/50 + backdrop-blur，悬停变实），选中操作时基本不遮挡画布内容。
- **快捷键**：Ctrl+A 全选、Ctrl+Z/Y 撤销恢复、Ctrl+S 保存、Delete 删除（带退场动画）；输入框聚焦时不拦截。
- **撤销/恢复**：`canvasHistory.ts` 50 条上限的 past/future 栈，删除/连线/新建/导入前记录快照。
- **画布日志**：右下角浮层只露最新 5 条（`log-toast` 淡入上移），低饱和中性色弱化存在感，`pointer-events-none` 不挡画布操作。

### 5.5 持久化

- 图片注册表：`output/.canvas/registry.json`，id = 内容 sha1 前缀（同内容去重，画布上同一文件只一个节点）；`.canvas` 永不自动清理（区别于 `.refs` 的 24h 清理）。
- 工作流文件：version 1 JSON 存 `output/workflows/`，图片节点**只持久化 registryId + 元数据**，url/absPath 由加载时按注册表实时重建——项目改名/移动后旧存档自愈；注册表缺失的 id 进 `missing`（前端标红「图片缺失」并阻止带缺图运行）。
- 恢复快照：独立于手动工作流，自动保存（防抖 1.5s）+ 挂载询问恢复。

### 5.6 新建节点定位

节点落点只有两个来源，任何入口不得自带偏移：

1. **视口中心（自动定位）**：所有创建入口（上传/历史导入/新建卡片/图片组/契约导入）统一以当前视口中心为落点：`getCreatePosition` 用 `screenToFlowPosition(容器中心)` 换算；连续创建由 `workflow.ts:staggerCreatePosition`（纯函数）阶梯错开（每次 +30px，视口移动后回到中心）。
2. **拖拽落点（用户指定）**：文件或工具栏按钮（新建卡片/图片组）拖到画布松开的位置就是用户指定的画布坐标，直接 `screenToFlowPosition(松开点)` 落点，**不经** `getCreatePosition`；文件批次内多图仍由 `canvasEntriesToNodes` 从落点横向排开，节点构建走 `buildPromptNode/buildGroupNode`（与点击新建同一构建）。

## 6. 关键数据流

### 6.1 UI 生图（经典表单与画布同管线）

1. 参考图**添加即上传**：`POST /api/upload-ref` 落盘 `output/.refs/`，返回 `{id, path, url, name, size, ext, mime}`，缩略图直接渲染。
2. 生成时传 `ref_paths`（JSON 数组引用已落盘文件，优先）或 `images`（multipart 兜底）。
3. `POST /api/generate` 提交即返回 `{taskId, status}`；前端 `useGenerationTask` 每 2s 轮询快照（竞态防护 + elapsed 本地计时，终态停止）。
4. 服务端线程池执行 `generate_image`（多参考图一次请求）→ 解码 b64 写入输出目录 → 写回 results/messages/total_cost。
5. 快照 `url=/api/image?path=` 回显（附带 fileSize/ext）；经典表单进画廊，画布按节点映射驱动状态灯并在 done 时**结果回流**（见 6.5）。

### 6.2 批量生成（命令行）

`batch` 子命令读产品目录的 `batch_prompts.json` → 过滤模块/解析底图路径（相对配置目录）→ rich 预览表格（不花钱）→ 进度条逐张生成 → 失败收集（退出码 1）。

### 6.3 单张生成（命令行）

`gen` 子命令：`resolve_size_with_ratio` + `build_default_output_path` → `generate_image` → 保存。

### 6.4 提示词契约导入

多模态模型按 `docs/prompt-contract.md` 契约回复（`=== 标题 ===` + 代码围栏 + `ratio: N:M`）→ 「粘贴导入」弹窗内 `parsePromptContract` 实时解析（标题锚点切分 + 围栏配对 + 块内首行 ratio 校验，缺漏进 issues 标红，**绝不静默猜测**）→ 确认后 `buildPromptNodes` 批量建卡（尺寸按 label 匹配 `config.sizes`，找不到回退并标记）→ 视口中心平铺 + 入场动画。

### 6.5 结果回流

任务 done 后：成功结果按 `registryId` 去重（画布已有同图不重建）→ 复制进画布注册表 → 建图片节点放在提示词**正下方居中横排**（`layoutPromptResults`）→ 自动连线 提示词 → 结果图。回流前检查提示词节点仍存在（删除后完成的结果不回流，避免幽灵节点）。

## 7. 前后端契约

### 7.1 API 一览

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/config` | `?win=`（沿用窗口号，缺省服务端分配） | sizes / qualities / defaultOutputDir / windowId / baseUrl / defaultModel / activeProfile（后三项来自 config.json profile 解析，前端展示确认切换生效） |
| GET | `/api/window/next` | 无 | { windowId }（原子分配，与 config 共用计数器） |
| GET | `/api/status` | 无 | { windowCounter }（只读最大已分配编号） |
| POST | `/api/select-folder` | { current } | { path }（系统弹窗，取消返回原值） |
| POST | `/api/open-folder` | { path } | { ok }（不存在自动创建；explorer 打开置前） |
| POST | `/api/upload-ref` | multipart：images | { refs[ id, path, url, name, size, ext, mime ] }（落盘 `output/.refs/`） |
| POST | `/api/delete-ref` | { path } | { ok }（尽力删除，文件不存在也算 ok） |
| POST | `/api/output-dir` | { path } | { ok }（记住输出路径，重启沿用） |
| POST | `/api/generate` | multipart：prompt/size/quality/output_dir/win + images 或 ref_paths | { taskId, status }（提交即返回） |
| GET | `/api/tasks/{task_id}` | 无 | 快照（queued → running → done/failed，可 cancelled；终态保留 10 分钟，超时 404） |
| POST | `/api/tasks/{task_id}/cancel` | 无 | { ok }（排队立即取消；运行中跑完当前张丢弃结果） |
| GET | `/api/image` | ?path= | 图片文件（FileResponse） |
| POST | `/api/canvas/upload` | multipart：images | { images[ entry ] }（复制进 `.canvas/` 并登记，同内容去重） |
| POST | `/api/canvas/import` | { paths } | { imported, skipped[{path,reason}] }（目录递归，路径须在 output 根内） |
| GET | `/api/canvas/images` | 无 | { images[entry+absPath] } |
| POST | `/api/canvas/image/delete` | { id } | { ok }（注册表移除 + 尽力删文件） |
| GET | `/api/health/details` | 无 | { ok, checks, issues[] }（启动自检，不泄漏配置） |
| GET | `/api/history` | ?limit=&query=&status= | { items }（仅给仍存在的图片附加预览 URL） |
| POST | `/api/history/import` | { path } | { imported, skipped }（只接受日志中真实存在的路径） |
| POST | `/api/canvas/workflow/save` | { name, nodes, edges } | { ok, path }（图片节点归一化：只存 registryId+元数据） |
| GET | `/api/canvas/workflow/list` | 无 | { workflows[ name, modified ] }（按修改时间倒序） |
| GET | `/api/canvas/workflow/load` | ?name= | { name, nodes, edges, missing }（按 registry 实时解析，缺失进 missing） |
| POST | `/api/canvas/recovery/save` | { nodes, edges } | { ok, path, name, savedAt }（独立恢复快照，不覆盖手动工作流） |
| GET | `/api/canvas/recovery/latest` | 无 | { ok, empty? | name?, savedAt?, nodes?, edges?, missing? } |

### 7.2 类型契约

前端类型契约见 `frontend/src/types.ts`（`AppConfig` / `GenerationTaskSnapshot` / `GenerateParams` / `ResultItem` / `WorkflowNode` / `WorkflowEdge` / `CanvasImageEntry`），与后端返回结构一一对应。改接口必须同步改这里和对应测试。

### 7.3 路径与配置基准

| 基准 | 定义 | 使用处 |
| --- | --- | --- |
| `WORK_ROOT` | `Path.cwd()`，进程启动时固定 | 默认输出目录、`display_path` 相对显示 |
| 配置文件目录 | `batch_prompts.json` 所在目录 | 批量任务里 assets/、output/ 相对解析 |
| `__file__` | 代码文件位置 | `.env`、`frontend/dist` 定位 |

- 默认输出目录 `WORK_ROOT/output`（config 的 DEFAULT_OUTPUT_DIR，api 与 server 共用）。
- `.env` 由 config 自动加载（不覆盖已存在的环境变量）：放密钥（`API_KEY_<PROFILE>` / 旧写法 `AIWANWU_API_KEY`）与本机覆盖（`ACTIVE_PROFILE`）；模板见 `.env.example`。
- 路径展示统一走 `server.display_path`：相对 WORK_ROOT + 正斜杠。

## 8. 关键设计决策

### 8.1 任务与并发

- **提交即返回**：`/api/generate` 请求线程只做校验与兜底文件落盘，生成在线程池，事件循环永不阻塞（新开窗口/加载页面不受影响）。
- **取消是逻辑取消**：running 无法中断上游请求，跑完当前张丢弃结果。
- **文件名并发唯一**：全局序号 + 时间戳防同秒碰撞；日志写 JSONL 用线程锁串行；tkinter 选择器与 explorer 置前用 `_UI_LOCK` 串行化；窗口计数器用锁保护自增。
- **生成超时**：请求 300 秒（图生图 + 2K 可能 1-2 分钟）。

### 8.2 画布数据模型

- **独立任务模型**：连线 = 参考图输入（非执行顺序），提示词节点间无依赖，「全部运行」= 全部提交到服务端并发队列。
- **派生路径不落盘**：图片节点只持久化 registryId，url/absPath 加载时实时重建——项目目录改名/移动后旧存档自愈；URL 构建单一入口 `canvas.image_url()`。
- **删除分层**：删节点仅断连线不删文件；删文件是图片节点显式操作。
- **缺图守卫**：参考图文件缺失时明确报错中止运行，不静默跳过导致不带参考图生成错误结果。

### 8.3 界面与交互

- **拖拽落点即用户指定坐标**：文件/工具栏按钮拖到哪节点就放在哪（首个图片左上角 = 鼠标松开处的画布坐标，多图从落点向右排开），不做重新居中——所见即所放；落点是唯一不经视口中心定位的创建来源（见 5.6）。
- **落点示意是纯 DOM 特效**：跟随光标的小胶囊（portal 到 body 的 fixed 元素），位置由 JS 直接写 transform——高频 dragover 移动不触发 React 渲染，只有拖拽起止等低频事件才改状态；文案/图标按意图区分（文件数量 / 新建类型），与画布光标同款品牌色加号图形，风格统一。
- **一屏全览**：不用 ReactFlow 初始 `fitView` prop——空画布时它会被 React Flow 延迟到「第一个节点出现」才执行，导致新建/上传后视口突然放大跳动（已实测复现）。统一走 `fitCanvasToContent()`（自动整理/加载工作流/恢复存档后调用），`minZoom` 放宽到 0.05，fitView 显式允许缩到 0.02，节点再多也能全览。
- **自定义光标**：画布空白区域用高对比十字准星 SVG data-URI 光标（细十字 + 白描边 + 中心白底品牌色加号，与拖拽落点示意同款图形，风格统一），平移切抓手；文件拖拽悬停时切系统 `copy` 光标；可拖出按钮（新建卡片/图片组）悬浮时给 grab 光标 + 品牌色呼吸光晕 + 拖拽图标（`.btn-draggable`）——拖入时可放感明确、可拖出暗示明显。
- **预览弹窗**：状态收敛为单一 `view{zoom,pan}`，缩放/夹紧数学在 `previewZoom.ts` 纯函数；滚轮以指针为锚缩放，放大后拖拽平移（位移阈值区分点击与拖拽），双击复位，Esc/点击空白关闭。
- **选中操作栏**：选中 ≥1 个节点即出现「运行所选/自动整理/设置输出路径/删除所选」，运行与设路径只作用于提示词卡片。

### 8.4 视觉与动效

- **动画类统一收敛**在 `index.css`，组件只引用类名不写内联动画；只动 transform/opacity（GPU 合成），缓动统一 easeOutQuint；`prefers-reduced-motion` 时全部降级瞬时。
- **transition 约束**：只作用于 border-color/box-shadow/opacity，**禁用 `transition-all`**——否则 textarea 拉伸等交互被尺寸插值拖慢（曾误判为性能问题，实为 CSS 插值）。
- **画布节点动画**：作用在内层 `.node-pop`（外层 `.react-flow__node` 是定位 transform，不可位移）；动画类是运行时标记，保存/加载时剥离，不持久化。
- **动效与浮层堆叠**：transform 动画（fill both）让元素成为 stacking context，含浮层的卡片需 `relative` + 更高 z-index 才能盖过后续卡片。
- **窗口主题色**：accent.ts 按窗口编号黄金角取色，运行时覆盖 `--color-brand`；favicon 同算法动态生成——多开一眼可辨；`--color-brand` 默认值是中性 slate 兜底（JS 加载前生效）。

### 8.5 多开与继承

- **窗口编号**：服务端锁保护原子递增；前端沿用优先级 `?win= > window.name（跨刷新记忆，复制标签不继承）> 服务端分配`。
- **新窗口状态继承**：参考图已服务端落盘，继承只传元信息 + 尺寸/质量/输出路径（sessionStorage，几百字节）；提示词不保留。
- **参考图服务端化**：添加进上传区即上传落盘 `.refs/`；启动时清理 24h 孤儿文件（不引入引用计数）。
- **记住输出路径**：用户修改即上报 + 生成成功兜底写入 `output/.last_output_dir`，重启沿用。

## 9. 防错清单（历史 bug 模式 → 规范）

> 这一章是踩坑记录沉淀成的**开发规范**。每条：现象 → 根因 → 规范 → 测试保障。新代码触碰这些领域前先对照。

### 9.1 React Flow 陷阱

1. **初始 fitView 延迟放大**。现象：空画布新建/上传后视口突然放大跳动。根因：`fitView` prop 在空画布时被延迟到首个节点出现才执行。规范：不用初始 fitView，统一 `fitCanvasToContent()`。测试：E2E 断言「新建后视口不突变」。
2. **nodeTypes 引用不稳定导致全节点重挂载**。现象：新增节点闪烁、入场动画重播。根因：依赖了每次渲染重建的对象（如 hook 返回值）导致 nodeTypes 每次重建。规范：nodeTypes 用 useMemo 且依赖只放稳定回调；hook 的稳定成员（useCallback 缓存）单独进依赖数组。测试：`useGenerationTask.test.ts` 锁成员引用稳定。
3. **动画类残留重播**。现象：加载工作流后节点集体重播入场动画。根因：`node-enter` 类未剥离。规范：动画类不持久化——保存/加载/恢复时剥离；另加 `animationend` 事件委托自动清理。测试：recovery/workflow 单测断言剥离。
4. **外层定位 transform 被动画污染**。现象：节点动画播放时位置甩飞。根因：动画作用在 `.react-flow__node`（定位元素）上。规范：动画只加在内层 `.node-pop`。测试：`canvasStyles.test.ts` 锁定选择器。
5. **选中态选择器挂错层级**。现象：图片/提示词节点选中无描边。根因：选中标记加在节点根 div，CSS 却写在外层 `.react-flow__node.node-selected`。规范：标记加节点根 div，选择器写 `.react-flow__node .panel-card.node-selected`；高亮走 node-related 外层类，两套统一主题色 outline。

### 9.2 事件与时序

1. **contextmenu 时序标志漏网**。现象：右键拖出画布松开仍弹浏览器菜单。根因：Windows 上 contextmenu 在右键**松开后**才触发，mouseup 提前清除屏蔽标志。规范：**无状态屏蔽**——window 捕获层一律屏蔽非输入区 contextmenu，不做按下/松开标志。测试：E2E 断言拖出画布松开零泄漏。
2. **拖拽落点示意状态残留**。现象：文件拖出浏览器窗口或按 Esc 取消后，画布拖拽落点示意（跟随光标的小胶囊）卡住不消失。根因：没有 drop 事件触发复位，dragenter/leave 计数悬空。规范：window 层 `dragend`/`blur` 统一复位拖拽状态（计数归零 + 关示意）；文件拖拽 dragenter/leave 用计数平衡（子元素间移动成对触发）；工具栏拖出示意全局跟随，离开画布不隐藏、由 `dragend` 清理；示意位置走直接写 DOM 的 transform，**不经 React 状态**（高频 dragover 不渲染）。测试：E2E 断言拖入显示示意（含数量）、dragover 跟随光标、drop 后示意消失、拖起按钮即显示。
3. **dragover 阶段 `dataTransfer.files` 为空**。现象：拖入图片时落点示意一直显示「未检测到图片」。根因：浏览器延迟到 drop 才填充 `files`（dragover 中为空列表）。规范：拖拽中的文件**数量**用 `dataTransfer.items`（kind === "file"）统计，`files` 只在 drop 时读取并做 `isImageFile` 过滤。测试：E2E 断言拖入时示意显示正确数量。
4. **drop 前先判定拖拽意图**。现象：文本拖进提示词输入框被容器 drop 拦截（preventDefault 后文字丢不进）。规范：drop/dragover 先按 `dataTransfer` 类型判定（文件 / 画布自定义类型），**无关拖拽一律放行**，只接管「文件」与「工具栏按钮」两类。测试：E2E 拖入非图片文件不产生节点。
5. **pointer capture 重定向 click**。现象：预览弹窗点击关闭误判/失效。根因：放大态拖拽的 setPointerCapture 会把 click target 重定向到容器。规范：关闭判定用 pointerdown 的**真实按下元素**；放大态区分点击与拖拽用位移阈值（>5px 才算拖拽），未移动且按在空白 = 点击关闭。测试：E2E「放大后点图片边缘空白关闭」。
6. **拦截型交互吞掉点击**。现象：容器 stopPropagation 后点击无处可去。规范：任何拦截 pointerdown 的交互必须自证「点击 vs 拖拽」，并在两种缩放态下都可关闭。
7. **全局监听器残留**。现象：卸载后仍触发 setState。规范：effect 内注册的 window 监听必须成对 removeEventListener 清理。

### 9.3 状态与引用

1. **提交竞态重复生成**。现象：快速连点同一节点提交两次。根因：映射登记在 await 之后。规范：submit 前同步登记占位（空 taskId），成功覆盖、失败清除；删除节点时兼容占位值。
2. **任务映射残留**。现象：删节点/加载工作流后状态卡死。规范：终态订阅回调解除映射，删节点/loadByName 同步清理两个映射表。
3. **级联偏移漂移**。现象：新建/上传节点越多越偏右下。根因：位置偏移按节点总数取模叠加（上传还双重偏移）。规范：位置策略只允许 `getCreatePosition` + `staggerCreatePosition`（纯函数，记忆最近落点阶梯 +30），任何入口不得自带偏移。测试：workflow 单测锁定阶梯行为。
4. **闭包捕获过期状态**。现象：回调里读到旧值。规范：需要最新值的地方一律走 ref（nodesRef/edgesRef/selectedIdsRef），回调依赖只放稳定成员。

### 9.4 CSS 与动效

1. **transition-all 拖慢拖拽类交互**。规范：transition 只含 border-color/box-shadow/opacity。
2. **transform 动画锁死 hover**。现象：hover 效果失效。规范：入场动画只动 opacity 的场景不用 fill both 的 transform；overflow-hidden 会裁剪悬浮操作栏/下拉面板——提示词卡片用 min-w-0 + truncate 防撑宽，不用 overflow-hidden。
3. **浮层被后续卡片盖住**。规范：含浮层的卡片加 relative + 更高 z-index。

### 9.5 坐标与几何

1. **screenToFlowPosition 基准**：它接受相对视口容器的屏幕坐标并内部修正（domNode = `.react-flow` wrapper），传 window 坐标给 `getBoundingClientRect` 中心即可，**不要再手动减 rect 偏移**（会双重偏移）。换算公式：flow = (screen - vx) / zoom，与库实现保持一致。
2. **预览缩放锚点**：transform-origin 为图片中心时，保持指针下内容不动的补偿公式 `pan_new = p - (p - pan_old) * k`（k = zoom_new/zoom_old）；数学进纯函数，UI 不重算。
3. **平移夹紧**：放大后图片主体不能丢出可视区，中心对称夹紧；未测量（box 为 0）时原样返回。测试：previewZoom.test.ts。

### 9.6 进程与并发

1. **taskkill /t 只杀子树不杀父**：单杀监听层会留 uv/python 宿主。规范：先回溯祖先链再连根杀。测试：test_main_process.py。
2. **PID 文件互相覆盖**：多开脚本同时写会误杀/漏杀。规范：端口是唯一真相源，动态探测，不落 PID 文件。
3. **多 worker 翻倍并发**：uvicorn 必须单 worker。
4. **配置 typo 静默失效**：config.json 拼错键名/选不存在的 profile → 控制台警告 + 回退默认。规范：profile 键有白名单校验（`unknown_profile_keys`），新增键必须同步加入 config 白名单和测试。

## 10. 测试与验证

### 10.1 单元测试

后端 `uv run pytest`（126 用例，纯函数 + 路由，不调上游不花钱）；前端 `cd frontend && npm test`（vitest，89 用例）。静态检查：`uv run ruff check .`、`npm run lint`（eslint），均零告警。

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `tests/test_core_api.py` | 13 | 尺寸解析 / 默认输出路径（并发唯一）/ 错误格式化 |
| `tests/test_core_batch.py` | 10 | 配置读取 / 路径解析 / 模块过滤 / dry-run |
| `tests/test_core_config.py` | 14 | API Key（环境变量 / 跟随 profile / 缺失报错）/ profile 解析（优先级 / 缺失回退 / 白名单校验）/ RATIOS 表结构 |
| `tests/test_server_helpers.py` | 21 | 窗口分配 / 安全路径白名单 / upload-ref / delete-ref / generate 同步性 |
| `tests/test_core_logging.py` | 7 | 日志写入 / 并发串行 / 路径相对化 |
| `tests/test_core_history.py` | 2 | 历史读取 / 坏行容忍 / 筛选 |
| `tests/test_core_canvas.py` | 19 | 注册表 / 内容去重 / import 边界 / workflow 归一化与自愈 / recovery |
| `tests/test_server_canvas.py` | 17 | canvas 路由 / workflow 往返 / missing 收集 / ref_paths 放行 |
| `tests/test_core_tasks.py` | 11 | 任务状态机 / 并发上限 / 取消 / 快照 / TTL 清理 |
| `tests/test_server_tasks.py` | 8 | generate 提交即返回 / multipart 临时文件清理 / 路径校验 / 任务路由 |
| `tests/test_main_process.py` | 4 | 端口探测 / 祖先链回溯 |
| `frontend/src/workflow.test.ts` | 36 | 自动布局 / 局部整理不漂移 / 动画类 / 连线约束 / 入边收集 / 落点阶梯 / 图片文件识别 / 节点构建器（提示词/图片组） |
| `frontend/src/canvasDrop.test.ts` | 11 | 拖拽意图解析（文件/工具栏/放行+回退）/ 文件识别 / 数量统计 / 落点示意文案 |
| `frontend/src/promptContract.test.ts` | 19 | 契约解析容错 / 尺寸映射 / 建卡 |
| `frontend/src/previewZoom.test.ts` | 5 | 缩放范围 / 平移夹紧 |
| `frontend/src/canvasHistory.test.ts` | 2 | 撤销 / 恢复 / 新分支清空 |
| `frontend/src/canvasStyles.test.ts` | 4 | 动效 CSS 选择器约束 |
| `frontend/src/recovery.test.ts` | 4 | 快照剥离动画类 / 运行期字段清除 |
| `frontend/src/useGenerationTask.test.ts` | 2 | hook 稳定成员引用 |
| `frontend/src/components/CanvasNodes.test.tsx` | 6 | 节点操作栏 / 双击行为 |

### 10.2 端到端（E2E）

`frontend/e2e/verify_canvas.py`（Playwright，自包含测试图，需服务已启动）：新建/上传居中（精确到像素）、视口不突变、右键菜单屏蔽（拖出画布 + 单击）、预览打开与点击空白关闭（含放大态）、文件拖拽添加（落点示意跟随光标与数量 / 落点精确 / 多图批次排开 / 非图片过滤）、工具栏按钮拖出新建（提示词卡片 / 图片组，示意文案与全局跟随、松开即建）。改画布交互后必须跑通它再加 E2E 断言。

### 10.3 未覆盖

`generate_image`（需真实网络与计费）、`run_batch_generation` 实际生成分支、`/api/status` 纯探测逻辑——靠 dry-run 与人工验证。

## 11. 变更守则

### 11.1 通用流程

1. 改接口：同步 `types.ts` + server 路由 + 对应测试 + 本文档 7.1 表。
2. 加后端能力：先在 `core/` 写纯逻辑和 pytest，再挂薄路由。
3. 加前端状态：先想清楚归谁持有（页面层/组件层/纯函数），纯逻辑进 `src/` 根下的纯函数模块并配单测。
4. 提交前必跑：`tsc --noEmit`、`npm run lint`、`npm test`、`npm run build`；画布改动再加 E2E。

### 11.2 改画布交互的检查清单

- 动没动「新建节点落点」？自动定位只允许走 `getCreatePosition`；拖拽落点是用户指定坐标，直接换算松开点，两处均不得自带偏移（见 5.6）。
- 动没动右键/点击/拖拽？对照 9.2 防错清单（拖拽类先对照 2/3/4 条），E2E 必须覆盖放大/未放大两种状态；文件拖拽与工具栏拖出加新交互须补 E2E（落点位置 + 多图批次排开 + 按钮拖起即显示示意）。
- 动没动节点动画/样式？对照 9.1、9.4，动画类记得保存/加载剥离。
- 动没动 fitView/缩放？对照 9.1 第 1 条，别用初始 fitView prop。
- 动没动任务状态？对照 9.3，双层守卫和映射清理不能丢。

### 11.3 文档同步

功能变更后同步三处：`README.md`（用户视角）、`ARCHITECTURE.md`（本文档：结构/决策/防错清单）、`.omo/CONTEXT.md`（跨会话交接，记录本轮改动与验证状态）。文档滞后即技术债。
