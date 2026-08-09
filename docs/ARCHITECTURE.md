# 架构说明

## 设计哲学

- **配置分离**：API Key、接口地址、尺寸映射集中在 `core/config.py`，代码不出现明文密钥
- **职责单一**：一个模块一个职责（config 管配置、api 管请求、batch 管批量、logging 管生成日志、server 管 HTTP、frontend 管界面）
- **产物与代码分离**：生成图片落到各产品目录的 `output/`，不进代码库
- **按名管理**：每个产品一个目录，素材/输出/批量配置随产品走，工具代码跨产品共享
- **类型安全**：前端 TypeScript 严格模式，API 响应全部类型化
- **路径可迁移**：路径一律以 `WORK_ROOT`（启动时固定）或配置文件所在目录为基准，无绝对路径硬编码

## 架构分层

```
浏览器 (React SPA)
   │  fetch /api/*（相对路径，不写死主机）
   ▼
FastAPI (server.py) ── 托管 frontend/dist 静态产物（单端口）
   │  core.api.generate_image
   ▼
上游生图 API (2api.aiwanwu.cc)
```

## 目录结构与模块依赖

```
tools/
├── main.py        # CLI 入口 ──┐
├── server.py      # FastAPI ───┼─→ core/api.py ─→ core/config.py（唯一配置源）
├── core/canvas.py # 画布注册表 ─┘       │         ├→ core/console.py（rich 终端输出）
│                                     ├→ core/logging.py（统一生成日志）
│                                     └→ 上游 API（requests）
├── frontend/      # React：api.ts ─→ server.py 的 /api/*（含画布页 CanvasPage）
└── tests/         # 纯函数单元测试（不碰网络）
```

依赖规则：`main.py`/`server.py`/`core/batch.py` 都调用 `core/api.py`；`core/api.py` 依赖 `core/config.py`（唯一配置源）与 `core/console.py`；`core/console.py` 只依赖 rich（无业务依赖，可被任意模块引用，CLI 统一输出入口：彩色成功/失败/信息 + Progress 进度条 + Panel 分组）；`core/canvas.py` 依赖 `core/config.py`（画布图片注册表与工作流存取，纯逻辑无 HTTP），`server.py` 路由薄层调用它；`server.py`/`core/batch.py`/`main.py` 共用 `core/logging.py` 记录生成日志；**没有反向/循环依赖**。

## 三条调用链

**1. UI 生成（Web 界面）**
```
UploadZone: 添加图片 → api.ts:uploadRef → POST /api/upload-ref → refs[{id,path,url,name,size,ext}]
App.tsx:handleGenerate → api.ts:generateImage（ref_paths 引用已落盘参考图）
  → POST /api/generate（multipart: prompt + ref_paths + size + quality + output_dir + win(窗口号)）
  → server.generate() → core.api.generate_image() → 上游 API
  → 保存图片到输出目录 → 返回 { results[url,size,cost,fileSize,ext], messages, totalCost }
  → Gallery 显示（GET /api/image?path= 读图，标注分辨率/格式/大小/费用）+ 日志区显示费用/用时
```

**2. 批量生成（命令行）**
```
main.py:handle_batch_command → core.batch:run_batch_generation
  → load_batch_config（项目目录下 batch_prompts.json）
  → filter_jobs_by_module / resolve_base_image_paths（相对配置目录）
  → rich 预览表格（任务/底图/成本）→ Progress 进度条逐张生成 → Panel 总结
  → 逐张 generate_image → 失败收集 → 返回 failed 列表（退出码 1）
```

**3. 单张生成（命令行）**
```
main.py:handle_gen_command → api.resolve_size_with_ratio + build_default_output_path
  → generate_image → 上游 API → 保存
```

## 前后端 API 契约

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/config` | `?win=`（可选，沿用已有窗口号，缺省由服务端分配） | sizes[] / qualities[] / defaultOutputDir（优先记住的上次输出路径，无记录按窗口分区 `output/win{N}`）/ hasApiKey / windowId |
| GET | `/api/window/next` | 无 | { windowId }（原子分配下一个窗口编号，启动脚本 / 界面按钮开新窗口用，与 config 共用计数器） |
| POST | `/api/select-folder` | { current } | { path }（系统弹窗选择，取消返回原值） |
| POST | `/api/open-folder` | { path } | { ok }（不存在自动创建；explorer 打开并置前） |
| POST | `/api/upload-ref` | multipart：images(多张同名，每张独立存储) | { refs[ id, path, url, name, size, ext, mime ] }（参考图落盘 `output/.refs/`，url 即 `/api/image?path=` 可直接渲染） |
| POST | `/api/delete-ref` | { path } | { ok }（删除已落盘的参考图，尽力而为，文件不存在也算 ok） |
| POST | `/api/output-dir` | { path } | { ok }（记住输出路径：用户一改前端即上报，重启后 config 默认返回） |
| POST | `/api/generate` | multipart：prompt、size、quality、output_dir、win，图片二选一：`images`(多张同名，未上传的本地兜底) 或 `ref_paths`(JSON 字符串数组，引用已上传参考图，优先) | { results[status,message,url?,size,cost,fileSize?,ext?], messages[], totalCost } |
| GET | `/api/image` | ?path= | 图片文件（FileResponse） |
| POST | `/api/canvas/upload` | multipart：images(多张) | { images[ id, relPath, absPath, name, size, ext, createdAt ] }（复制进 `output/.canvas/` 并登记，同内容去重） |
| POST | `/api/canvas/import` | { paths: [目录或文件绝对路径] } | { imported[entry], skipped[{path,reason}] }（目录递归收集图片，路径必须落在 output 根内） |
| GET | `/api/canvas/images` | 无 | { images[entry+absPath] }（注册表全量） |
| POST | `/api/canvas/image/delete` | { id } | { ok }（注册表移除 + 尽力删文件） |
| POST | `/api/canvas/workflow/save` | { path, name, nodes, edges } | { ok }（写 version 1 JSON 文件，用户指定路径） |
| GET | `/api/canvas/workflow/load` | ?path= | { name, nodes, edges, missing[registryId] }（相对路径解析 + 文件存在性校验，缺失进 missing） |

`/api/upload-ref` 返回的 `url` 复用 `/api/image`，前端可直接 `<img>` 加载；`/api/generate` 的 `ref_paths` 接受 `output/.refs/` 与 `output/.canvas/` 两个目录内的路径（`safe_ref_path_allowlist` 逐根 commonpath 校验，跨盘 root 单独捕获不误伤，防路径穿越），与 `images` 互斥、`ref_paths` 优先——图生图不二次上传大图。

前端类型契约见 `frontend/src/types.ts`（`AppConfig` / `GenerateResponse` / `ResultItem`），与后端返回结构一一对应。

## 数据流（一次图生图）

1. 参考图**添加即上传**：前端收文件 → `POST /api/upload-ref` 落盘 `output/.refs/` → 返回 `{ id, path, url, name, size, ext, mime }`，缩略图直接 `<img src=url>`
2. 生成时前端传 `ref_paths`（JSON 数组引用已落盘文件）→ server 校验路径在 `output/.refs/` 内 → 结果路径算好
3. `generate_image` 读全部参考图 → POST edits 接口（多图一次请求）→ 解码 `b64_json` 写入结果文件
4. 生成 `url=/api/image?path=` 回显，附带 `fileSize`（`os.path.getsize`）与 `ext`（`Path.suffix`）供画廊标注
5. 前端画廊 `<img src="/api/image?path=...">` 加载；缩略图下标注 `分辨率 · 格式 · 文件大小 · 费用`；日志区显示 `已保存 · 相对路径（尺寸）`

## 路径与配置基准

| 基准 | 定义 | 使用处 |
| --- | --- | --- |
| `WORK_ROOT` | `Path.cwd()`，进程启动时固定 | 默认输出目录、`display_path` 相对显示 |
| 配置文件目录 | `batch_prompts.json` 所在目录 | 批量任务里 `assets/`、`output/` 相对解析 |
| `__file__` | 代码文件位置 | `.env`、`frontend/dist` 定位 |

- 默认输出目录：`WORK_ROOT/output`（`core/config.py:DEFAULT_OUTPUT_DIR`，api 与 server 共用）
- `.env`：`core/config.py` 同项目根，自动加载，不覆盖已存在的环境变量
- 路径展示统一走 `server.display_path`：相对 `WORK_ROOT` + 正斜杠

## 错误处理

- 统一 `core/api.py:format_error(e, limit)` → `类型: 消息` 截断，供 server 界面与 batch 命令行共用
- 请求非 200 → `RuntimeError` 上抛；batch 收集失败 id 继续；UI 单请求，失败在日志区展示具体原因

## 测试覆盖

`uv run pytest`（0.7s，全部纯函数，不调 API 不花钱）：

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/test_core_api.py` | 13 | `resolve_size_with_ratio` / `build_default_output_path`（含并发唯一）/ `format_error` |
| `tests/test_core_batch.py` | 9 | 配置读取 / 路径解析 / 模块过滤 / dry_run 预览 |
| `tests/test_core_config.py` | 3 | `get_api_key`（环境变量/缺失报错）/ RATIOS 表结构 |
| `tests/test_server_helpers.py` | 13 | `size_cost` / `display_path` / `get_config` 窗口分配（递增/沿用/非法回退）/ `next_window` 共用计数器 / `generate` 为同步函数（不阻塞事件循环）/ `safe_ref_path`（REF_DIR 内放行、穿越拒绝）/ `upload-ref` 元信息与落盘 / `delete-ref`（删除/容忍缺失/非法路径） |
| `tests/test_core_logging.py` | 7 | `log_generation` 写入 / 字段 / win 可选 / 并发串行写 / 路径相对化 |
| `tests/test_core_canvas.py` | 14 | 注册表读写/原子写/损坏兜底 / register 内容去重（同内容一文件）/ 不同内容 / 不存在 / import 目录递归 + 单文件 + 越界拒绝 + 缺失跳过 + 非图片跳过 / delete 移除 + 容忍文件缺失 / list 含 absPath / allowlist 双根放行 + 穿越拒绝 |
| `tests/test_server_canvas.py` | 13 | canvas upload 登记 / import 目录+单文件+越界 skipped / images 列表 / image delete + 容忍缺失 / workflow save 写 version1 + 不可序列化报错 / load 往返 + missing 收集 + 版本错误 + 文件缺失 / generate ref_paths 放行 canvas（monkeypatch 挡真实 API） |

未覆盖：`generate_image`（需真实网络与计费）、`run_batch_generation` 实际生成分支（同样需 API），编排与请求层靠 dry_run 与人工验证。

## 关键决策

- **API Key**：环境变量 `AIWANWU_API_KEY` 或 `tools/.env`（git 忽略），未配置抛清晰错误
- **尺寸档位**：1K=0.05 / 2K=0.10 / 4K=0.20，选项由 `/api/config` 下发，前端不硬编码
- **多张参考图**：实测上游 edits 接受多个 image 字段，一次请求全部作为参考（用途由提示词决定），不是逐张生成
- **静态资源 no-cache**：本地迭代频繁，中间件统一加 `Cache-Control: no-cache`，前端更新即时生效
- **打开文件夹置前**：后台进程启动的 explorer 窗口默认不抢前台，用 Win32 API（枚举窗口 + 模拟 Alt 绕过前台锁）置前
- **前端未构建**：dist 缺失时根路径返回 503 提示页，不静默空白
- **生成日志**：每次生成（UI/批量/CLI）由 `core/logging.py` 统一记录到 `logs/generation.jsonl`（git 忽略），字段：时间/模式/参考图数/提示词/尺寸/质量/结果/费用/耗时/输出路径/窗口号（多开时）
- **多开窗口**：服务端 `itertools.count` 原子分配递增编号；前端沿用优先级 `?win= > window.name（跨刷新记忆，复制标签不继承）> 服务端分配`；默认输出优先记住的上次路径（`output/.last_output_dir`：用户改路径前端即 `POST /api/output-dir` 上报 + generate 成功兜底写入，config 读取，服务重启沿用），无记录才按窗口分区 `output/win{N}`，顶栏显示「窗口 #N」，可一键开新窗口；启动脚本按 N 开新窗、Q 停服务（隐藏后台启动 + PID 记录，`--no-browser` 由脚本统一控制开窗；交互菜单由 `main.py menu` 子命令用 rich 渲染 Panel，PID 从 `%TEMP%/aig_pid_{port}.txt` 读取，文件不存在则视为既有服务、Q 不误杀）
- **新窗口状态继承**：页面内「＋ 新窗口」不再序列化图片——参考图在拖入上传区时已落盘服务端（见「参考图服务端化」），继承时只把 `refs` 元信息（path / name / size / ext）+ 尺寸/质量/输出路径写入 `sessionStorage`（几百字节，永不会超 5MB 配额），再 `window.open`——新标签拷贝一份 sessionStorage，挂载时读取并清除，用 `/api/image?path=` 直接渲染参考图；仅提示词不保留；命令行 `?win=` 直开无该键，保持全新窗口
- **参考图服务端化**：参考图在**添加进上传区时**即 `POST /api/upload-ref` 落盘 `output/.refs/`（输出根下隐藏缓存目录，独立于窗口输出分区，不混入生成产物），返回 `{ id, path, url, name, size, ext, mime }`；前端缩略图直接加载 `url`，移除时 `POST /api/delete-ref` 尽力删除；生成时传 `ref_paths` 复用已落盘文件，避免大图二次上传。存储位置与文件名复用「按名管理 / 并发唯一」约定（全局序号 + 时间戳防撞）。清理：服务启动时删除 `output/.refs/` 中 mtime 超 24h 的孤儿文件（前端删除失败 / 上传后未用的情况兜底），不引入引用计数
- **窗口主题色**：`accent.ts` 按编号黄金角取色（137.508° 分布，相邻编号色相差大），运行时覆盖 `--color-brand` CSS 变量，全局强调色（按钮/焦点/图标/徽章/上传阴影）随窗口变色；确定性函数，同编号恒定、刷新不变
- **界面动效**：动画类统一收敛在 `frontend/src/index.css` 动效层，组件只引用类名不写内联动画——卡片入场 `enter-up`（配 `.enter-delay-N` 交错）、图片加载淡入 `img-reveal`、缩略图增删 `pop-in`/`fade-out`（移除在 `animationend` 后才真正卸载）、日志行 `log-line`、画布右下角日志轮播 `log-toast`（新条目淡入上移，只露最新 3 条）、生成中按钮呼吸 `pulse-glow`（`color-mix` 跟随窗口主题色）；只动 transform/opacity（GPU 合成不触发重排），缓动统一 easeOutQuint；`prefers-reduced-motion` 时全部降级为瞬时切换
- **画廊单图自动包裹实际边缘**：`w-full h-auto` 由图片自身比例决定高度（不设 aspect-ratio 占位、不 object-cover 裁切），加载前显示主题色浅调占位块，图片就位后 `img-reveal` 淡入；入场动画只动 opacity，transform 留给 hover transition，避免 animation fill 锁死 hover 效果
- **动效与浮层堆叠**：transform 动画（fill both）会让元素永久成为 stacking context，导致内部浮层（下拉面板）的 z-index 无法再与兄弟元素竞争——含浮层的卡片需 `relative` + 更高 z-index 才能盖过后续卡片（尺寸/质量卡 `z-30`）
- **并发安全**：默认文件名带全局序号（秒级时间戳同秒必撞）；日志写 JSONL 用 `threading.Lock` 串行追加；tkinter 选择器与 explorer 置前用 `_UI_LOCK` 串行化（多窗口并发无运行矛盾）
- **图片回显**：`GET /api/image?path=` 动态读文件（本地单机工具），生成时返回带 URL 的结果
- **超时**：生成请求 300 秒（图生图 + 2K 可能 1-2 分钟）
- **生成不阻塞事件循环**：`/api/generate` 用同步 `def`（FastAPI 自动放线程池），生成期间其他请求（开新窗口/加载页面/查看图片）照常响应；若写成 `async def` 且内部同步调 API，会卡死整个 uvicorn 事件循环——生成 1-2 分钟里所有请求全部挂起
- **端口**：默认 7860，`main.py ui --port` 可改
- **画布工作流（无限画布）**：顶部「经典表单 / 无限画布」tab 切换（`?mode=canvas` 直达），React Flow v12（`@xyflow/react`）受控模式。**独立任务模型**：图片节点 + 提示词节点，连线=参考图输入（非执行顺序），提示词节点之间无依赖，「全部运行」= 并发 2 队列并行，无全局启动节点——每个提示词节点都是自己的启动节点。**图片三源归一**：本地上传 / 输出目录导入 / 生成结果回流，全部复制进 `output/.canvas/`（永不自动清理，区别于 `.refs` 24h 清理）并登记 `registry.json`（`{id, relPath, name, size, ext, createdAt}`，id=内容 sha1 前缀，同内容去重——画布上同一文件只一个节点，复用走多出边）。**连线硬约束**：图片节点仅 source 锚点、提示词节点仅 target 锚点，`isValidConnection` 拒绝其余连接；提示词节点顶部 target 仅允许一条入边（已有入边再连会被拒），多图请经「图片组」聚合后连入。**节点操作栏统一**：三类节点共用 `NodeActions` 组件——悬停时在节点右侧（`left-full`）竖排浮出图标按钮（图片：预览/替换/删除；图片组：删除；提示词：状态灯+删除），`ActionButton` 统一图标 + `nodrag` 防误拖，不遮挡节点内容。**hover 置顶**：`.react-flow__node:hover { z-index: 1001 }` 高于 selected/dragging（1000），确保右侧操作栏不被相邻卡片遮挡。**可视化核验**：悬停/选中提示词节点高亮入边（`.edge-highlight`）+ 关联图片描边（`.node-related`）+ 引用计数徽标，运行日志明示参考图张数。**运行快照**：点运行时 `snapshotIncomingAbsPaths` 锁定入边集合（纯函数），运行中改画布不打断已提交任务。**删除分层**：删节点仅断连线不删文件；删文件是图片节点显式操作（前端校验画布内无引用）。**工作流文件**：version 1 JSON（nodes[image 存 registryId+position / prompt 存 data+position] + edges），保存/加载走 `/api/canvas/workflow/*`，后端相对路径解析 + 文件存在性校验 + missing 列表（前端标红），默认 `output/workflows/`；`core/canvas.py` 纯逻辑（注册表线程锁 + 原子写）供 server 薄层调用。**画布日志**：右下角浮层轮播（`CanvasLog`），只露最新 3 条，新条目 `log-toast` 淡入上移，`pointer-events-none` 不挡画布操作，画布向下占满剩余空间。**经典模式**保持原行为不变（回归测试覆盖）
- **提示词卡片**：节点最小宽 300px，提示词 textarea `rows=5` + `leading-relaxed`（可纵向拖拽缩放），兼顾多行编辑与紧凑
- **生成状态机**：提示词节点状态 `idle → queued → running → done`（前端 `status` 字段）。状态指示用右侧操作栏顶部的状态灯（`StatusLight`，圆点配色）：就绪灰、排队琥珀、生成中品牌色 + `animate-pulse` 呼吸、完成绿、失败红；详情（秒数 / 张数 / 失败原因）走 `title` 悬停提示，避免文字徽标导致布局跳动。点「全部运行」时所有待运行节点**立即**置 `queued`（运行按钮禁用），由 worker 真正开始执行时转 `running`；`running` 由独立计时器每秒刷新 `elapsed`；完成记录 `resultCount`。状态变更通过 `setNodes` 更新对应节点 `data.status` / `data.elapsed` / `data.resultCount` / `data.message`
- **防重复生成**：双层守卫——`queuedRef`（Set）+ `runningRef`（Set）两个 ref 记录在途节点 id。点单节点「运行」时先检查两个集合，命中则直接忽略；点「全部运行」时过滤掉已在集合中的节点。`finally` 兜底清理，删节点时也同步清理，避免状态残留导致按钮永久禁用
- **结果回流去重**：生成完成后结果图按 `registryId` 过滤——画布上已存在同 registryId 的节点则不再创建新节点（避免节点 id `img-<id>` 冲突导致 React Flow 警告）。回流只对新增节点建连线，连线 id `${promptId}->${resultId}` 自然不重复。回流前还检查目标提示词节点是否仍存在于 `nodesRef`，删节点后完成的结果不再回流（避免幽灵节点出现在默认坐标）
- **自动整理布局**：`workflow.ts:autoLayout` 纯函数，以提示词卡片为中心做模块化布局——每个提示词组内：参考图紧贴提示词左边缘（`refX = promptX - refGap - refWidth`）、组内垂直居中；结果图紧贴右边缘、同样垂直居中；多组从上到下排列；孤立节点（未连线图片/分组）在最左侧独立成列。布局参数集中在 `LAYOUT` 常量（refGap/resultGap/nodeGap/groupGap/leftMargin/topMargin），节点估算尺寸集中在 `NODE_SIZES`。整理后调 `rfInstance.fitView({ padding: 0.2, duration: 300 })` 自适应居中（60ms 延迟等 React 渲染新坐标）。**无外部图布局库依赖**（曾用 dagre，因"同层节点堆一列"不符合需求已移除，改纯手写几何计算）
