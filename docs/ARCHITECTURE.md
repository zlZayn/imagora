# 架构说明

## 设计哲学

- **配置分离**：API Key、接口地址、尺寸映射集中在 `core/config.py`，代码不出现明文密钥
- **职责单一**：一个模块一个职责（config 管配置、api 管请求、batch 管批量、server 管 HTTP、frontend 管界面）
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
│                                     └→ A站 API（requests）
├── frontend/      # React：api.ts ─→ server.py 的 /api/*
└── tests/         # 纯函数单元测试（不碰网络）
```

依赖规则：`main.py`/`server.py`/`core/batch.py` 都调用 `core/api.py`；`core/api.py` 只依赖 `core/config.py`；**没有反向/循环依赖**。

## 三条调用链

**1. UI 生成（Web 界面）**
```
App.tsx:handleGenerate → api.ts:generateImage
  → POST /api/generate（multipart: prompt + image(可多张，融合为一张) + size + quality + output_dir）
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
| GET | `/api/config` | 无 | sizes[] / qualities[] / defaultOutputDir |
| POST | `/api/select-folder` | { current } | { path }（系统弹窗选择，取消返回原值） |
| POST | `/api/open-folder` | { path } | { ok }（不存在则自动创建后打开） |
| POST | `/api/generate` | multipart：prompt、image(可多张，融合为一张)、size、quality、output_dir | { results[status,message,url?,size,cost], messages[], totalCost } |
| GET | `/api/image` | ?path= | 图片文件（FileResponse） |

前端类型契约见 `frontend/src/types.ts`（`AppConfig` / `GenerateResponse` / `ResultItem`），与后端返回结构一一对应。

## 数据流（一次图生图）

1. 前端收文件 → FormData 上传
2. server 把底图写入**临时文件**（`tempfile`，不污染输出目录），结果路径算好
3. `generate_image` 读底图 → POST edits 接口 → 解码 `b64_json` 写入结果文件
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
- 请求非 200 → `RuntimeError` 上抛；batch 收集失败 id 继续；UI 逐张容错并汇总

## 测试覆盖

`uv run pytest`（0.5s，全部纯函数，不调 API 不花钱）：

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/test_core_api.py` | 12 | `resolve_size_with_ratio` / `build_default_output_path` / `format_error` |
| `tests/test_core_batch.py` | 8 | 配置读取 / 路径解析 / 模块过滤 / dry_run 预览 |
| `tests/test_core_config.py` | 3 | `get_api_key`（环境变量/缺失报错）/ RATIOS 表结构 |
| `tests/test_server_helpers.py` | 4 | `size_cost` / `display_path` |

未覆盖：`generate_image`（需真实网络与计费）、`run_batch_generation` 实际生成分支（同样需 API），编排与请求层靠 dry_run 与人工验证。

## 关键决策

- **API Key**：环境变量 `AIWANWU_API_KEY` 或 `tools/.env`（git 忽略），未配置抛清晰错误
- **尺寸档位**：1K=0.05 / 2K=0.10 / 4K=0.20，选项由 `/api/config` 下发，前端不硬编码
- **图片回显**：`GET /api/image?path=` 动态读文件（本地单机工具），生成时返回带 URL 的结果
- **超时**：生成请求 300 秒（图生图 + 2K 可能 1-2 分钟）
- **端口**：默认 7860，`main.py ui --port` 可改
