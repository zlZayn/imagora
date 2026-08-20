# 上下文交接文档（CONTEXT）

> 维护约定：本文件随工作进展持续更新，记录跨会话交接所需的关键事实——当前工作、架构决策、验证状态、已知问题。交接时先读这里。

## 当前工作（2026-08-20，存储统一 + 命名重构 + 目录改名，已推送 origin/main）

后端存储全面统一为「资产（asset）语义」，目录规范名 .assets，迁移脚本可一步到最新。

### 存储架构（今日定型）
- core/registry.py —— 资产注册表（ASSET_DIR=.assets / register_asset / import_assets / delete_asset / list_assets / resolve_asset / image_url / safe_ref_path_allowlist），内容 sha1 去重、原子写、条目可选 kind(canvas/result/ref)+sourceKey；注册表 v2 包装 {schemaVersion:2, images:{id:entry}}（v1 裸 dict 兼容读）
- core/graphstore.py —— 图/工作流/提交（workflow_* / submission_* / recovery_*、_resolve_image_node_paths / _strip_derived_node_paths），图片节点只存 registryId、路径由 registry.resolve_asset 实时重建
- core/canvas.py —— 兼容 shim：星号 re-export registry+graphstore（含私有 _REGISTRY_LOCK）；from core import canvas 仍可用；无业务逻辑
- core/pathtrust.py —— 路径白名单单一实现（match_roots），server 与 registry 共用
- 资产库目录：output/.assets/（规范名）；存量 .canvas 已迁移

### 统一生成模型（画布 / 经典同一套后端存储）
- 经典表单生成 done 时：结果图 kind=result、用到的 .refs 参考图 kind=ref 注册进 .assets，落提交图快照（output/submissions/<submissionId>.json，图片组→提示词→结果连线），账本 generation.jsonl 每行带 submissionId/inputAssetIds/outputAssetIds
- 经典结果区「导入画布」= POST /api/canvas/import-submission 整图重建（前端 mergeSubmissionGraph 按 registryId 去重复用）
- 画布：拖图/上传注册 kind=canvas，生成结果回流注册 kind=result 建节点并连线

### 迁移（一步到最新）
- python scripts/migrate_canvas_v2.py --apply = v1→v2 + 回填 kind + 迁 .canvas 到 .assets（重写 relPath）+ 升工作流；默认只报告，--apply 才整目录备份+搬运+读回校验，幂等
- --output-root 路径：指定别的输出目录（脚本会同时 patch registry/graphstore/canvas 三模块常量）
- 安全测试已加：test_plan_or_apply_one_shot_full_upgrade（真实结构副本综合升级）+ test_migrate_script_cli_output_root_end_to_end（CLI 子进程）
- 真实数据已迁移：363 张图在 output/.assets，resolve_asset 命中

### 待办（备份未删，先勿删）
- output/.canvas-bak-20260820-210134/（542MB，目录改名全量备份，与 .assets 同内容）
- output/workflows/*.bak-20260820-181820（14 个 v1 旧格式工作流备份）
- 待确认应用从 .assets 正常运行（启动看到 363 图、能生成）后，再删 542MB 备份：rm -rf output/.canvas-bak-20260820-210134；工作流 .bak 可随时删

## 验证状态（本轮）
- 后端 pytest：166 passed（注意 pytest 需 --basetemp 指向 ASCII 路径，项目路径含中文「网店实习」会触发 tmp_path 坑；用 C:/t/imagora-pytest）
- 前端 tsc / vitest / build：通过 / 95 passed / 成功
- ruff：uv run ruff check . 零告警
- E2E verify_canvas.py：需服务运行（.venv\Scripts\python.exe -m main ui --no-browser --port 7860 后另开终端执行）；本次未跑

## 已知问题/注意
- server.py LSP 报「Argument missing for parameter id」是误报（GenerationTask.id 有 default_factory），pre-existing，勿修
- pytest tmp：--basetemp=C:/t/imagora-pytest（ASCII）
- 前端 dist/ 已构建（git 忽略）

## 下一步
- 删 542MB 备份前先启动一次应用确认 .assets 正常（见「待办」）
- 可选（未做，低优先）：/api/canvas/* 端点与 CanvasPage 等画布功能名保持 canvas（正确域标签，不建议再改）；注册表 JSON 键 images 为数据格式键（保留）
- 历史（8-13 v1→v2 迁移雏形）已并入；更早画布交互/多 profile 见 git 历史
