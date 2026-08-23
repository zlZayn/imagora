# 上下文交接文档（CONTEXT）

> 维护约定：本文件随工作进展持续更新，记录跨会话交接所需的关键事实——当前工作、架构决策、验证状态、已知问题。交接时先读这里。

## 当前工作（2026-08-23，CLI 全量功能 + 资产旁路公共函数抽取 + 文档同步）

把 CLI `gen` 子命令做成与 web 表单完全对等，并消除 server/CLI 两端资产旁路逻辑的分叉。

### 本轮改动

* **CLI 全量功能**（main.py）：

  * 新增 `config` 子命令：实时读 `config.json` 当前 profile，打印支持的尺寸（含费用）/ 比例 + 档位 / 质量取值 / 默认值，方便对照填参

  * `gen` 子命令所有参数显式指定（与 web 表单对等）：`--size`/`--ratio` 二选一必填、`--quality` 必填、`--output` 必填，缺则退出码 2 并提示运行 `config`

  * 多参考图：`-i` 可多次传（与 web 表单 `images` 字段等价，走 edits 接口一次提交）

  * 输出路径：文件路径直接用；目录则自动生成 `ai_<时间戳>_<序号>.<后缀>` 文件名（与 server.run\_generation 同算法，序号保证并发唯一）

  * `--no-asset` 跳过资产旁路 + 提交快照（纯生成模式，账本无 submissionId/assetIds 字段，且不生成 submission\_id 避免孤儿引用）

  * 成功后旁路注册资产 + 落提交快照 + 写全量账本，与 web 端产物同源可互查

  * 单次同步等待结果（不进全局并发池），失败退出码 1；多张并行由调用方开多终端各跑一条 gen

* **资产旁路公共函数抽取**（core/graphstore.py）：

  * 新增 `persist_submission_assets(submission_id, prompt, params, ref_paths, result_paths, win=0) -> dict | None`

  * 把「注册参考图 + 结果图 + 落提交快照 + 返回 asset\_ids」封装为公共函数，server（web）与 main（CLI）共用同一份逻辑

  * server.py 的 `_persist_submission` 重构为委托 `graphstore.persist_submission_assets`，删除 \~30 行内联注册循环

  * main.py 的 `handle_gen_command` 也委托同一函数，杜绝两端分叉

* **账本语义修正**（main.py）：`submissionId` 只在确实落了提交快照（`submission_meta is not None`）时才记入账本——失败 / `--no-asset` / persist 抛错 都不记，避免账本出现「指向不存在 submission\_\*.json 的孤儿 id」

* **测试**：

  * 新增 `tests/test_main_cli.py`（25 用例）：`_validate_gen_args` 必填/互斥/取值校验 / `_resolve_output` 文件路径/目录/后缀解析 / `handle_gen_command` 文生图+图生图+多参考图+失败+`--no-asset`+比例档位端到端 / `handle_config_command` 输出 / `build_argument_parser` 子命令挂接

  * `tests/test_core_canvas.py` 新增 5 用例覆盖 `persist_submission_assets` 公共函数：正常注册 / 重复参考图去重 / 无结果返回 None / 结果路径不存在返回 None / 参考图部分缺失

* **文档同步**：README.md 新增「命令行（CLI）全量功能」章节（必填/可选参数 + config 示例）；ARCHITECTURE.md 更新 main.py 职责、CLI 子命令表、6.3 单张生成链路、graphstore 模块条目、依赖规则、6.5 经典结果落盘（委托公共函数）、测试用例数表（168→204，新增 test\_main\_cli.py 行，test\_core\_canvas 27→32）

### 存储架构（未变，沿用上一轮定型）

* core/registry.py / core/graphstore.py / core/canvas.py（shim）/ core/pathtrust.py / core/history.py —— 同 8-20 轮，未改架构，仅 graphstore 新增 `persist_submission_assets` + `next_submission_id` 公开函数

* 资产库目录：output/.assets/；提交快照：output/submissions/<submissionId>.json

### 验证状态（本轮）

* 后端 pytest：204 passed on Linux（5 个 Windows 专属测试在 Linux 失败，pre-existing，**需在 Windows 验证**）

* ruff：6 个 pre-existing 警告（4 个 EXE001 shebang + 2 个 RUF015 旧测试 `[...][0]`），本轮 0 新增警告

* 前端 / E2E：本轮无前端改动，未跑

### 待测 / 待完善（跨会话记得做）

* **Windows 平台验证**（必做）：以下 5 个测试在 Linux 失败，需在 Windows 上确认是否通过：

  * `tests/test_core_batch.py::test_resolve_absolute_path_kept` —— 测 `C:/abs/y.png` 在 Windows 是绝对路径（Linux 不是）

  * `tests/test_main_process.py::TestFindPortPids::test_detects_an_ephemeral_listener` —— 测 `netstat -ano` 探测端口监听者（Linux 无此命令）

  * `tests/test_main_process.py::TestProcessAncestors::test_includes_self_and_reaches_a_root` —— 测 `powershell.exe` 查父进程（Linux 无此命令）

  * `tests/test_server_helpers.py::test_display_path_outside_work_root_uses_relative_up` —— 测 `D:/other/place/b.png` 跨盘相对化（Linux 无盘符）

  * `tests/test_server_helpers.py::test_display_path_cross_drive_hides_drive_letter` —— 测 `Z:/foreign/image.png` 隐藏盘符（Linux 无盘符）

* 这 5 个都是平台特定测试，非本轮回归；如 Windows 也失败再修，否则保持现状（不要在 Linux 上为兼容而 skip，会掩盖 Windows 真实行为）

## 上一轮工作（2026-08-20，迁移 dry-run 预检增强 + 文档过期项清理）

在上一轮「存储统一 + 命名重构 + 目录改名」基础上，补一项 dry-run 体验缺口 + 三处文档同步。

### 本轮改动

* **迁移 dry-run 预检增强**（core/registry.py + core/graphstore.py + scripts/migrate.py）：修复三处 dry-run 报告"误报 0 / 误报 missing"的体验缺口，让只报告模式也能完整预览要动什么：

  * `core/registry.py:detect_registry(path=None)` 加可选路径参数；`upgrade_registry(apply=False)` 在主路径 `.assets/registry.json` 缺失时，去 `LEGACY_ASSET_DIR/registry.json` 探测一遍，若是 v1/v2 则返回 `action='pending-relocate'`——避免存量 .canvas 还没搬到 .assets 时误报 "missing 无需迁移"。scripts/migrate.py 的 \_milestone 加 `pending-relocate` 报告分支输出「\[注册表] v1 待迁目录后升级（N 条，加 --apply）」。

  * `core/graphstore.py:migrate_workflows` summary 加 `ready` 字段统计 dry-run 检测到的 `upgrade-ready`；scripts/migrate.py 的 `[工作流]` 行 `待升级/已升级` 字段从只看 `upgraded` 改为 `ready + upgraded`——之前 dry-run 对 v1 工作流也会报 0，现在能正确报"待升级 N"。apply 流程未变（relocate 优先于 upgrade，搬完后 pending-relocate 自然消失；apply 后 ready=0、upgraded=N，幂等后两字段皆 0）。

* **README/ARCHITECTURE 过期项清理**：

  * README.md 删掉 `--rename-asset-dir` 过期参数说明（目录改名已并入 `--apply` 默认流程），改为澄清「旧目录里的 v1 清单会一并搬到新目录再升级，无需手动分步」。

  * ARCHITECTURE.md 设计哲学第 1.2 节把"canvas 管画布存储"改为反映 shim 拆分后的现实（registry 管注册表、graphstore 管工作流、canvas 仅 shim re-export）。

  * ARCHITECTURE.md 删掉 `core/migrate.py` 模块条目（提交 f6a81e2 已删该中间层），改为说明迁移逻辑各归其位（registry.migrate / graphstore.migrate\_workflows / scripts/migrate.py 仅协调+打印）。

  * ARCHITECTURE.md 用例数表更新：147→168 总数、test\_core\_canvas 20→27、test\_core\_migrate 16→19、test\_core\_logging 7→8、test\_core\_history 2→3，并补 `tests/test_core_pathtrust.py | 2 | 路径白名单（match_roots 双根/单根/跨盘不误伤）`（之前完全漏列）。

  * ARCHITECTURE.md 第 5.5 节迁移用法更新：增 dry-run pending-relocate 说明、把"升级 v1→v2"改为"一步到最新"（含迁目录）、调整 --skip-meta-backfill 表述。

* 新增 2 个迁移用例覆盖新分支：`test_upgrade_reports_pending_relocate_when_legacy_has_v1`（dry-run 检测 legacy v1 + 不写文件）+ `test_upgrade_pending_relocate_clears_after_apply`（apply 后 pending-relocate 消失、读到 v2+kid）。

### 存储架构（沿用上一轮定型，未变）

* core/registry.py —— 资产注册表（ASSET\_DIR=.assets / register\_asset / import\_assets / delete\_asset / list\_assets / resolve\_asset / image\_url / safe\_ref\_path\_allowlist / detect\_registry(支持任意路径预检) / migrate），内容 sha1 去重、原子写、条目可选 kind(canvas/result/ref)+sourceKey；注册表 v2 包装 {schemaVersion:2, images:{id:entry}}（v1 裸 dict 兼容读）

* core/graphstore.py —— 图/工作流/提交（workflow\_\* / submission\_\* / recovery\_\*、\_resolve\_image\_node\_paths / \_strip\_derived\_node\_paths / migrate\_workflows），图片节点只存 registryId、路径由 registry.resolve\_asset 实时重建

* core/history.py —— 历史账本读取 + 迁移（backfill\_output\_asset\_ids：旧行按 output 内容 sha1 反查注册表补 outputAssetIds，报告优先/备份/原子/幂等/无法反查跳过）+ resolve\_output\_path（server 委托，统一路径解析）

* core/canvas.py —— 兼容 shim：星号 re-export registry+graphstore（含私有 \_REGISTRY\_LOCK）；from core import canvas 仍可用；无业务逻辑

* core/pathtrust.py —— 路径白名单单一实现（match\_roots），server 与 registry 共用

* 资产库目录：output/.assets/（规范名）；存量 .canvas 已迁移

### 历史显示语义（以注册表为准）

* GET /api/history：存在性优先按 outputAssetIds 经 registry.resolve\_asset 解析（注册表副本在 .assets，移动原文件不丢）；无 assetIds 的旧行回退 output 路径 isfile

* 旧行缺 assetIds 由迁移补齐（scripts/migrate.py --apply 含 history.backfill\_output\_asset\_ids），无 assetIds 也可以先跑一次生成/导入让新记录带上

### 统一生成模型（画布 / 经典同一套后端存储）

* 经典表单生成 done 时：结果图 kind=result、用到的 .refs 参考图 kind=ref 注册进 .assets，落提交图快照（output/submissions/<submissionId>.json，图片组→提示词→结果连线），账本 generation.jsonl 每行带 submissionId/inputAssetIds/outputAssetIds

* 经典结果区「导入画布」= POST /api/canvas/import-submission 整图重建（前端 mergeSubmissionGraph 按 registryId 去重复用）

* 画布：拖图/上传注册 kind=canvas，生成结果回流注册 kind=result 建节点并连线

### 迁移（一步到最新，本轮增 dry-run 预检）

* python scripts/migrate.py = dry-run 只报告；存量 .canvas 内 v1 清单会报 `pending-relocate` 提示待迁后升级（不再误报 missing/noop）

* python scripts/migrate.py --apply = v1→v2 + 回填 kind + 迁 .canvas 到 .assets（重写 relPath）+ 升工作流；先整目录备份+搬运+读回校验，幂等

* \--output-root 路径：指定别的输出目录（脚本会同时 patch registry/graphstore/canvas 三模块常量）

* 安全测试已加：test\_plan\_or\_apply\_one\_shot\_full\_upgrade + test\_migrate\_script\_cli\_output\_root\_end\_to\_end + test\_upgrade\_reports\_pending\_relocate\_when\_legacy\_has\_v1 + test\_upgrade\_pending\_relocate\_clears\_after\_apply

* 真实数据已迁移：363 张图在 output/.assets，resolve\_asset 命中

### 待办（备份未删，先勿删）

* output/.canvas-bak-20260820-210134/（542MB，目录改名全量备份，与 .assets 同内容）

* output/workflows/\*.bak-20260820-181820（14 个 v1 旧格式工作流备份）

* 待确认应用从 .assets 正常运行（启动看到 363 图、能生成）后，再删 542MB 备份：rm -rf output/.canvas-bak-20260820-210134；工作流 .bak 可随时删

## 验证状态（本轮）

* 后端 pytest：168 passed（注意 pytest 需 --basetemp 指向 ASCII 路径，项目路径含中文「网店实习」会触发 tmp\_path 坑；用 C:/t/imagora-pytest）

* 前端 tsc / vitest / build：未跑（本轮无前端改动，沿用上一轮通过 / 95 passed / 成功）

* ruff：uv run ruff check . 零告警

* E2E verify\_canvas.py：需服务运行（.venv\Scripts\python.exe -m main ui --no-browser --port 7860 后另开终端执行）；本次未跑（本轮无前端改动）

## 已知问题/注意

* server.py LSP 报「Argument missing for parameter id」是误报（GenerationTask.id 有 default\_factory），pre-existing，勿修

* pytest tmp：--basetemp=C:/t/imagora-pytest（ASCII）

* 前端 dist/ 已构建（git 忽略）

## 下一步

* 删 542MB 备份前先启动一次应用确认 .assets 正常（见「待办」）

* 可选（未做，低优先）：/api/canvas/\* 端点与 CanvasPage 等画布功能名保持 canvas（正确域标签，不建议再改）；注册表 JSON 键 images 为数据格式键（保留）

* 历史（8-13 v1→v2 迁移雏形 → 8-20 存储统一+目录改名 → 8-20 dry-run 预检增强）见 git 历史

