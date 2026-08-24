# core/ — 后端核心模块（无 HTTP 纯逻辑层）

FastAPI 路由（`server.py`）与 CLI（`main.py`）共用的业务层。**不依赖 HTTP / FastAPI**；铁律：任何模块不得 import `server.py` / `main.py`（反向依赖）。

## 本地常用命令

- 全部 core 测试：`.venv\Scripts\python.exe -m pytest tests/test_core_*.py --basetemp=<ASCII 临时目录>`
- 单文件测试：`.venv\Scripts\python.exe -m pytest tests/test_core_config.py -v --basetemp=<ASCII 临时目录>`
- Ruff 检查：`.venv\Scripts\python.exe -m ruff check core`

## 该目录特有坑

- `canvas.py` 只是兼容 shim（星号 re-export registry + graphstore），**不在这里加新逻辑**
- pytest 必须加 `--basetemp=<ASCII 临时目录>`（工作目录含中文，默认 tmp 路径会挂）
- 单测绝不真调上游生图 API（花钱）：`api.py` 走 monkeypatch mock，保持接口可注入
- 展示与导入同源防错条（ARCHITECTURE 9.7）：`resolve_history_asset_path` 在 `server.py`，不在 core

## 文件索引（每个文件：职责 / 关键导出 / 被谁依赖 / 改后必测）

### [config.py](config.py)
- 职责：配置中心——profile 解析（优先级：环境变量 > config.json > 内置）、API Key、尺寸/质量选项、成本表
- 关键导出：`resolve_profile_config()`、`unknown_profile_keys()`、`get_api_key()`、`cost_for_size()` + 模块常量（`SIZE_OPTIONS` / `QUALITY_OPTIONS` / `RATIOS` / `WORK_ROOT` / `DEFAULT_OUTPUT_DIR` 等）
- 被谁依赖：`server.py`、`api.py`、`main.py`、`registry.py`、`history.py`
- 改后必测：`tests/test_core_config.py`
- 注意：新增 config.json profile 键必须同步 `unknown_profile_keys` 白名单 + 测试

### [api.py](api.py)
- 职责：上游生图 API 封装（全项目唯一外部网络调用点）
- 关键导出：`generate_image()`、`format_error()`、`resolve_size_with_ratio()`、`build_default_output_path()`
- 被谁依赖：`server.py`（/api/generate）、`main.py`（gen 子命令）
- 改后必测：`tests/test_core_api.py` + `tests/test_main_cli.py`
- 注意：单测已 mock 上游，不花钱；改接口签名要同步 `server.py` 与 `main.py` 两处调用

### [tasks.py](tasks.py)
- 职责：生成任务状态机（纯内存 TaskManager：queued → running → done/failed/cancelled，终态 TTL 清理）
- 关键导出：`TaskManager`（`submit` / `snapshot` / `cancel`）、`GenerationTask`、`MAX_CONCURRENCY`
- 被谁依赖：`server.py`（/api/generate、/api/tasks/*）
- 改后必测：`tests/test_core_tasks.py` + `tests/test_server_tasks.py`
- 注意：任务表纯内存；uvicorn 必须单 worker（见 ARCHITECTURE 9.6）

### [registry.py](registry.py)
- 职责：资产注册表（`output/.assets`，v2 包装，内容 sha1 去重，kind=canvas/result/ref，永不自动清理）
- 关键导出：`register_asset()`、`resolve_asset()`、`delete_asset()`、`list_assets()`、`import_assets()`、`image_url()`、`safe_ref_path_allowlist()`、`migrate(apply, rebuild, backfill)`（迁移入口）
- 被谁依赖：`graphstore.py`、`server.py`（/api/canvas/*、/api/history）、`main.py`（CLI 旁路）、`scripts/migrate.py`、`core/canvas.py`（shim）
- 改后必测：`tests/test_core_canvas.py` + `tests/test_core_migrate.py` + `tests/test_server_helpers.py`（history 注册表解析）
- 注意：**改存储格式（schema/目录/字段语义）必须先 Handoff 确认**（硬边界）

### [graphstore.py](graphstore.py)
- 职责：图/工作流存储——workflow（手动工作流）/ submission（提交快照）/ recovery（恢复快照），原子写
- 关键导出：`workflow_save()` / `workflow_list()` / `workflow_load()`、`submission_save()` / `submission_load()`、`recovery_save()` / `recovery_latest()`、`persist_submission_assets()`（server/CLI 共用资产旁路）、`migrate_workflows()`、`next_submission_id()`、`sanitize_workflow_name()`
- 被谁依赖：`server.py`（/api/canvas/workflow/*、/api/canvas/import-submission、recovery）、`main.py`（CLI 旁路）、`scripts/migrate.py`、shim
- 改后必测：`tests/test_core_canvas.py` + `tests/test_server_canvas.py` + `tests/test_main_cli.py`
- 注意：`persist_submission_assets` 两端共用，改前查 server 与 main 两处调用；**改存储格式必须先 Handoff 确认**

### [history.py](history.py)
- 职责：生成历史 JSONL 读取（容错坏行、筛选）+ 账本迁移（backfill）
- 关键导出：`read_generation_history()`、`resolve_output_path()`、`backfill_output_asset_ids()`
- 被谁依赖：`server.py`（/api/history、/api/history/import，白名单同源判定）
- 改后必测：`tests/test_core_history.py` + `tests/test_server_helpers.py`
- 注意：展示与导入同源（ARCHITECTURE 9.7）——改路径解析逻辑必须两端一致

### [logging.py](logging.py)
- 职责：`logs/generation.jsonl` 账本写入（线程安全、路径相对化）
- 关键导出：`log_generation()`
- 被谁依赖：`server.py`、`main.py`（gen/batch）
- 改后必测：`tests/test_core_logging.py`

### [console.py](console.py)
- 职责：终端输出（rich）——CLI 菜单/提示
- 关键导出：`console`、`print_success()`、`print_error()`、`print_info()`、`print_warn()`、`print_panel()`
- 被谁依赖：`main.py`
- 改后必测：无专项测试（纯展示，人工验证）

### [imageinfo.py](imageinfo.py)
- 职责：图片头解析（PNG/JPEG/GIF/WebP/BMP 宽高/格式）
- 关键导出：`image_dimensions()`
- 被谁依赖：`registry.py`（登记时探测元数据）
- 改后必测：`tests/test_core_imageinfo.py`

### [pathtrust.py](pathtrust.py)
- 职责：路径白名单校验（`match_roots`，双根/跨盘安全）
- 关键导出：`match_roots()`
- 被谁依赖：`server.py`（safe_ref_path_allowlist 委托）、`registry.py`
- 改后必测：`tests/test_core_pathtrust.py`

### [batch.py](batch.py)
- 职责：CLI 批量编排（config 读取、模块过滤、dry-run 预览、串行生成）
- 关键导出：`load_batch_config()`、`resolve_base_image_paths()`、`filter_jobs_by_module()`、`run_batch_generation()`
- 被谁依赖：`main.py`（batch 子命令）
- 改后必测：`tests/test_core_batch.py`

### [canvas.py](canvas.py)
- 职责：**兼容 shim**——星号 re-export `registry` + `graphstore`（旧导入 `from core import canvas` 兼容）
- 被谁依赖：`server.py`（`from core import canvas`）
- 警告：不加新逻辑；新增公开函数应落在 registry/graphstore 本体

## 上下游依赖

### 本目录用到了谁
- 标准库：`pathlib` / `json` / `hashlib` / `threading` / `tempfile` / `time`
- 第三方：`requests`（api.py）、`rich`（console.py）
- 无 `server.py` / `main.py` 反向依赖（铁律，已 grep 验证）

### 谁用到了本目录
- `server.py`：canvas / config / graphstore / history / api / logging / tasks
- `main.py`：api / config / batch / console / logging / graphstore
- `scripts/migrate.py`：registry / graphstore / history
- `tests/`：全部测试文件（见 tests/README.md）

## 变更影响路由（改前必看）

- 改 `registry.py`
  → 查 `graphstore.py`（persist_submission_assets）与 `scripts/migrate.py` 调用方式
  → 跑 `tests/test_core_canvas.py` + `tests/test_core_migrate.py` + `tests/test_server_helpers.py`
  → 如改存储格式/schema → **必须 Handoff 确认**

- 改 `graphstore.py`
  → 查 `server.py` 路由与 `main.py` CLI 旁路
  → 跑 `tests/test_core_canvas.py` + `tests/test_server_canvas.py` + `tests/test_main_cli.py`
  → `persist_submission_assets` 改后端到两端均验证

- 改 `api.py`
  → 查 `tasks.py` / `server.py` / `main.py` gen 子命令
  → 跑 `tests/test_core_api.py` + `tests/test_main_cli.py`（已 mock 上游，不花钱）

- 改 `config.py`
  → 新增 profile 键必须同步 `unknown_profile_keys` 白名单
  → 跑 `tests/test_core_config.py`

- 改 `history.py`
  → 查 `server.py` /api/history 两路由
  → 跑 `tests/test_core_history.py` + `tests/test_server_helpers.py`
  → 验证展示与导入同源（ARCHITECTURE 9.7）

- 改 `tasks.py`
  → 查 `server.py` 任务路由
  → 跑 `tests/test_core_tasks.py` + `tests/test_server_tasks.py`

- 改 `logging.py` / `console.py` / `imageinfo.py` / `pathtrust.py` / `batch.py`
  → 跑对应单测（见文件索引「改后必测」）；console 无测试改后人工目验

## 参考

- 设计背景（注册表/旁路/防错）：[../ARCHITECTURE.md](../ARCHITECTURE.md) 2.2 / 5.5 / 6.1 / 7.1 / 9.7
- 测试命令细节：[../tests/README.md](../tests/README.md)