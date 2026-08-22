# 上下文交接文档（CONTEXT）

> 维护约定：本文件随工作进展持续更新，记录跨会话交接所需的关键事实——当前工作、架构决策、验证状态、已知问题。交接时先读这里。

## 当前工作（2026-08-20，迁移 dry-run 预检增强 + 文档过期项清理）

在上一轮「存储统一 + 命名重构 + 目录改名」基础上，补一项 dry-run 体验缺口 + 三处文档同步。

### 本轮改动
- **迁移 dry-run 预检增强**（core/registry.py + core/graphstore.py + scripts/migrate.py）：修复三处 dry-run 报告"误报 0 / 误报 missing"的体验缺口，让只报告模式也能完整预览要动什么：
  - `core/registry.py:detect_registry(path=None)` 加可选路径参数；`upgrade_registry(apply=False)` 在主路径 `.assets/registry.json` 缺失时，去 `LEGACY_ASSET_DIR/registry.json` 探测一遍，若是 v1/v2 则返回 `action='pending-relocate'`——避免存量 .canvas 还没搬到 .assets 时误报 "missing 无需迁移"。scripts/migrate.py 的 _milestone 加 `pending-relocate` 报告分支输出「[注册表] v1 待迁目录后升级（N 条，加 --apply）」。
  - `core/graphstore.py:migrate_workflows` summary 加 `ready` 字段统计 dry-run 检测到的 `upgrade-ready`；scripts/migrate.py 的 `[工作流]` 行 `待升级/已升级` 字段从只看 `upgraded` 改为 `ready + upgraded`——之前 dry-run 对 v1 工作流也会报 0，现在能正确报"待升级 N"。apply 流程未变（relocate 优先于 upgrade，搬完后 pending-relocate 自然消失；apply 后 ready=0、upgraded=N，幂等后两字段皆 0）。
- **README/ARCHITECTURE 过期项清理**：
  - README.md 删掉 `--rename-asset-dir` 过期参数说明（目录改名已并入 `--apply` 默认流程），改为澄清「旧目录里的 v1 清单会一并搬到新目录再升级，无需手动分步」。
  - ARCHITECTURE.md 设计哲学第 1.2 节把"canvas 管画布存储"改为反映 shim 拆分后的现实（registry 管注册表、graphstore 管工作流、canvas 仅 shim re-export）。
  - ARCHITECTURE.md 删掉 `core/migrate.py` 模块条目（提交 f6a81e2 已删该中间层），改为说明迁移逻辑各归其位（registry.migrate / graphstore.migrate_workflows / scripts/migrate.py 仅协调+打印）。
  - ARCHITECTURE.md 用例数表更新：147→168 总数、test_core_canvas 20→27、test_core_migrate 16→19、test_core_logging 7→8、test_core_history 2→3，并补 `tests/test_core_pathtrust.py | 2 | 路径白名单（match_roots 双根/单根/跨盘不误伤）`（之前完全漏列）。
  - ARCHITECTURE.md 第 5.5 节迁移用法更新：增 dry-run pending-relocate 说明、把"升级 v1→v2"改为"一步到最新"（含迁目录）、调整 --skip-meta-backfill 表述。
- 新增 2 个迁移用例覆盖新分支：`test_upgrade_reports_pending_relocate_when_legacy_has_v1`（dry-run 检测 legacy v1 + 不写文件）+ `test_upgrade_pending_relocate_clears_after_apply`（apply 后 pending-relocate 消失、读到 v2+kid）。

### 存储架构（沿用上一轮定型，未变）
- core/registry.py —— 资产注册表（ASSET_DIR=.assets / register_asset / import_assets / delete_asset / list_assets / resolve_asset / image_url / safe_ref_path_allowlist / detect_registry(支持任意路径预检) / migrate），内容 sha1 去重、原子写、条目可选 kind(canvas/result/ref)+sourceKey；注册表 v2 包装 {schemaVersion:2, images:{id:entry}}（v1 裸 dict 兼容读）
- core/graphstore.py —— 图/工作流/提交（workflow_* / submission_* / recovery_*、_resolve_image_node_paths / _strip_derived_node_paths / migrate_workflows），图片节点只存 registryId、路径由 registry.resolve_asset 实时重建
- core/history.py —— 历史账本读取 + 迁移（backfill_output_asset_ids：旧行按 output 内容 sha1 反查注册表补 outputAssetIds，报告优先/备份/原子/幂等/无法反查跳过）+ resolve_output_path（server 委托，统一路径解析）
- core/canvas.py —— 兼容 shim：星号 re-export registry+graphstore（含私有 _REGISTRY_LOCK）；from core import canvas 仍可用；无业务逻辑
- core/pathtrust.py —— 路径白名单单一实现（match_roots），server 与 registry 共用
- 资产库目录：output/.assets/（规范名）；存量 .canvas 已迁移

### 历史显示语义（以注册表为准）
- GET /api/history：存在性优先按 outputAssetIds 经 registry.resolve_asset 解析（注册表副本在 .assets，移动原文件不丢）；无 assetIds 的旧行回退 output 路径 isfile
- 旧行缺 assetIds 由迁移补齐（scripts/migrate.py --apply 含 history.backfill_output_asset_ids），无 assetIds 也可以先跑一次生成/导入让新记录带上

### 统一生成模型（画布 / 经典同一套后端存储）
- 经典表单生成 done 时：结果图 kind=result、用到的 .refs 参考图 kind=ref 注册进 .assets，落提交图快照（output/submissions/<submissionId>.json，图片组→提示词→结果连线），账本 generation.jsonl 每行带 submissionId/inputAssetIds/outputAssetIds
- 经典结果区「导入画布」= POST /api/canvas/import-submission 整图重建（前端 mergeSubmissionGraph 按 registryId 去重复用）
- 画布：拖图/上传注册 kind=canvas，生成结果回流注册 kind=result 建节点并连线

### 迁移（一步到最新，本轮增 dry-run 预检）
- python scripts/migrate.py = dry-run 只报告；存量 .canvas 内 v1 清单会报 `pending-relocate` 提示待迁后升级（不再误报 missing/noop）
- python scripts/migrate.py --apply = v1→v2 + 回填 kind + 迁 .canvas 到 .assets（重写 relPath）+ 升工作流；先整目录备份+搬运+读回校验，幂等
- --output-root 路径：指定别的输出目录（脚本会同时 patch registry/graphstore/canvas 三模块常量）
- 安全测试已加：test_plan_or_apply_one_shot_full_upgrade + test_migrate_script_cli_output_root_end_to_end + test_upgrade_reports_pending_relocate_when_legacy_has_v1 + test_upgrade_pending_relocate_clears_after_apply
- 真实数据已迁移：363 张图在 output/.assets，resolve_asset 命中

### 待办（备份未删，先勿删）
- output/.canvas-bak-20260820-210134/（542MB，目录改名全量备份，与 .assets 同内容）
- output/workflows/*.bak-20260820-181820（14 个 v1 旧格式工作流备份）
- 待确认应用从 .assets 正常运行（启动看到 363 图、能生成）后，再删 542MB 备份：rm -rf output/.canvas-bak-20260820-210134；工作流 .bak 可随时删

## 验证状态（本轮）
- 后端 pytest：168 passed（注意 pytest 需 --basetemp 指向 ASCII 路径，项目路径含中文「网店实习」会触发 tmp_path 坑；用 C:/t/imagora-pytest）
- 前端 tsc / vitest / build：未跑（本轮无前端改动，沿用上一轮通过 / 95 passed / 成功）
- ruff：uv run ruff check . 零告警
- E2E verify_canvas.py：需服务运行（.venv\Scripts\python.exe -m main ui --no-browser --port 7860 后另开终端执行）；本次未跑（本轮无前端改动）

## 已知问题/注意
- server.py LSP 报「Argument missing for parameter id」是误报（GenerationTask.id 有 default_factory），pre-existing，勿修
- pytest tmp：--basetemp=C:/t/imagora-pytest（ASCII）
- 前端 dist/ 已构建（git 忽略）

## 下一步
- 删 542MB 备份前先启动一次应用确认 .assets 正常（见「待办」）
- 可选（未做，低优先）：/api/canvas/* 端点与 CanvasPage 等画布功能名保持 canvas（正确域标签，不建议再改）；注册表 JSON 键 images 为数据格式键（保留）
- 历史（8-13 v1→v2 迁移雏形 → 8-20 存储统一+目录改名 → 8-20 dry-run 预检增强）见 git 历史
