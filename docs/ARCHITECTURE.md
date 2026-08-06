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
A站生图 API (2api.aiwanwu.cc)
```

## 目录结构与模块依赖

```
tools/
├── main.py        # CLI 入口 ──┐
├── server.py      # FastAPI ───┼─→ core/api.py ─→ core/config.py（唯一配置源）
├── core/batch.py  # 批量编排 ──┘       │
│                                     ├→ core/logging.py（统一生成日志）
│                                     └→ A站 API（requests）
├── frontend/      # React：api.ts ─→ server.py 的 /api/*
└── tests/         # 纯函数单元测试（不碰网络）
```

依赖规则：`main.py`/`server.py`/`core/batch.py` 都调用 `core/api.py`；`core/api.py` 只依赖 `core/config.py`；`server.py`/`core/batch.py`/`main.py` 共用 `core/logging.py` 记录生成日志；**没有反向/循环依赖**。

## 三条调用链

**1. UI 生成（Web 界面）**
```
App.tsx:handleGenerate → api.ts:generateImage
  → POST /api/generate（multipart: prompt + images(多张同名) + size + quality + output_dir + win(窗口号)）
  → server.generate() → core.api.generate_image() → A站 API
  → 保存图片到输出目录 → 返回 { results[url,size,cost], messages, totalCost }
  → Gallery 显示（GET /api/image?path= 读图）+ 日志区显示费用/用时
```

**2. 批量生成（命令行）**
```
main.py:handle_batch_command → core.batch:run_batch_generation
  → load_batch_config（项目目录下 batch_prompts.json）
  → filter_jobs_by_module / resolve_base_image_paths（相对配置目录）
  → 逐张 generate_image → 失败收集 → 返回 failed 列表（退出码 1）
```

**3. 单张生成（命令行）**
```
main.py:handle_gen_command → api.resolve_size_with_ratio + build_default_output_path
  → generate_image → A站 API → 保存
```

## 前后端 API 契约

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/config` | `?win=`（可选，沿用已有窗口号，缺省由服务端分配） | sizes[] / qualities[] / defaultOutputDir（按窗口分区 `output/win{N}`）/ hasApiKey / windowId |
| GET | `/api/window/next` | 无 | { windowId }（原子分配下一个窗口编号，启动脚本 / 界面按钮开新窗口用，与 config 共用计数器） |
| POST | `/api/select-folder` | { current } | { path }（系统弹窗选择，取消返回原值） |
| POST | `/api/open-folder` | { path } | { ok }（不存在自动创建；explorer 打开并置前） |
| POST | `/api/generate` | multipart：prompt、images(多张同名)、size、quality、output_dir、win | { results[status,message,url?,size,cost], messages[], totalCost } |
| GET | `/api/image` | ?path= | 图片文件（FileResponse） |

前端类型契约见 `frontend/src/types.ts`（`AppConfig` / `GenerateResponse` / `ResultItem`），与后端返回结构一一对应。

## 数据流（一次图生图）

1. 前端收文件 → FormData 上传（可多张，同名 image 字段）
2. server 把底图写入**临时文件**（`tempfile`，不污染输出目录），结果路径算好
3. `generate_image` 读全部底图 → POST edits 接口（多图一次请求）→ 解码 `b64_json` 写入结果文件
4. 清理临时文件 → 生成 `url=/api/image?path=` 回显
5. 前端画廊 `<img src="/api/image?path=...">` 加载；日志区显示 `已保存 · 相对路径（尺寸）`

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
| `tests/test_server_helpers.py` | 9 | `size_cost` / `display_path` / `get_config` 窗口分配（递增/沿用/非法回退）/ `next_window` 共用计数器 / `generate` 为同步函数（不阻塞事件循环） |
| `tests/test_core_logging.py` | 7 | `log_generation` 写入 / 字段 / win 可选 / 并发串行写 / 路径相对化 |

未覆盖：`generate_image`（需真实网络与计费）、`run_batch_generation` 实际生成分支（同样需 API），编排与请求层靠 dry_run 与人工验证。

## 关键决策

- **API Key**：环境变量 `AIWANWU_API_KEY` 或 `tools/.env`（git 忽略），未配置抛清晰错误
- **尺寸档位**：1K=0.05 / 2K=0.10 / 4K=0.20，选项由 `/api/config` 下发，前端不硬编码
- **多张参考图**：实测 A站 edits 接受多个 image 字段，一次请求全部作为参考（用途由提示词决定），不是逐张生成
- **静态资源 no-cache**：本地迭代频繁，中间件统一加 `Cache-Control: no-cache`，前端更新即时生效
- **打开文件夹置前**：后台进程启动的 explorer 窗口默认不抢前台，用 Win32 API（枚举窗口 + 模拟 Alt 绕过前台锁）置前
- **前端未构建**：dist 缺失时根路径返回 503 提示页，不静默空白
- **生成日志**：每次生成（UI/批量/CLI）由 `core/logging.py` 统一记录到 `logs/generation.jsonl`（git 忽略），字段：时间/模式/参考图数/提示词/尺寸/质量/结果/费用/耗时/输出路径/窗口号（多开时）
- **多开窗口**：服务端 `itertools.count` 原子分配递增编号；前端沿用优先级 `?win= > window.name（跨刷新记忆，复制标签不继承）> 服务端分配`；默认输出按窗口分区 `output/win{N}`，顶栏显示「窗口 #N」，可一键开新窗口；启动脚本按 N 开新窗、Q 停服务（隐藏后台启动 + PID 记录，`--no-browser` 由脚本统一控制开窗）
- **窗口主题色**：`accent.ts` 按编号黄金角取色（137.508° 分布，相邻编号色相差大），运行时覆盖 `--color-brand` CSS 变量，全局强调色（按钮/焦点/图标/徽章/上传阴影）随窗口变色；确定性函数，同编号恒定、刷新不变
- **并发安全**：默认文件名带全局序号（秒级时间戳同秒必撞）；日志写 JSONL 用 `threading.Lock` 串行追加；tkinter 选择器与 explorer 置前用 `_UI_LOCK` 串行化（多窗口并发无运行矛盾）
- **图片回显**：`GET /api/image?path=` 动态读文件（本地单机工具），生成时返回带 URL 的结果
- **超时**：生成请求 300 秒（图生图 + 2K 可能 1-2 分钟）
- **生成不阻塞事件循环**：`/api/generate` 用同步 `def`（FastAPI 自动放线程池），生成期间其他请求（开新窗口/加载页面/查看图片）照常响应；若写成 `async def` 且内部同步调 API，会卡死整个 uvicorn 事件循环——生成 1-2 分钟里所有请求全部挂起
- **端口**：默认 7860，`main.py ui --port` 可改
