# Imagora 更新交接手册（08-19 → 08-23）

> 给四天前旧仓库的快速同步手册。重点：新功能模块位置、迁移路径、模块拆分。
> 本期共 39 条 commit，按时间倒序整理，每日聚焦当日主线变更。

## TL;DR — 四天内的四条主线

| 主线 | 关键 commit | 影响面 |
|---|---|---|
| A. 存储统一与一步迁移 | `25a2b8f` ~ `f3736b6` | 后端 core 全量重构 + 迁移脚本 |
| B. 计费/配置收敛 | `bcf92dab` | core/config + server + batch |
| C. 历史与资产联动 | `6e773e75` ~ `fa05bb60` | core/history + logging + server |
| D. 画布布局与渲染 | `ed0fb38e` ~ `6c99f87` | 前端 layout.ts + LOD 抽象 |

---

## A. 存储统一与一步迁移（08-20，11 条 commit）

### A.1 模块拆分（旧仓库的核心变化）

旧仓库 `core/canvas.py` 单文件承担资产注册表 + 工作流存储，已拆为三模块：

| 新模块 | 职责 | 旧仓库对应 |
|---|---|---|
| [core/registry.py](file:///workspace/core/registry.py) | 资产注册表（`ASSET_DIR`/`register_asset`/`resolve_asset`/`migrate`/`detect_registry`） | canvas.py 的注册表部分 |
| [core/graphstore.py](file:///workspace/core/graphstore.py) | 工作流/提交/恢复（`workflow_*`/`submission_*`/`recovery_*`/`migrate_workflows`） | canvas.py 的工作流部分 |
| [core/canvas.py](file:///workspace/core/canvas.py) | 兼容 shim（星号 re-export 前两者，含私有 `_REGISTRY_LOCK`） | 旧 canvas.py（仅过渡用） |

**磁盘目录改名**：`output/.canvas/` → `output/.assets/`（代码 `ASSET_DIR` 切换，工作流只存 registryId 不存目录名，迁移工具内置改名步骤）。

### A.2 存储格式 v2 版本化

| 格式 | 旧 v1 | 新 v2（当前） |
|---|---|---|
| 注册表 | 裸 dict（顶层 id→entry） | 包装 `{schemaVersion:2, images:{id:entry}}` |
| 工作流 | `{version:1, name, nodes, edges}` | `{version:2, name, savedAt, nodes, edges}` |
| 条目元数据 | 仅 id/relPath/name/size/ext/createdAt | + 可选 width/height/format + kind/sourceKey |

**关键不变量**：运行时只写 v2，可读 v1 与 v2（老数据零失效）；未知版本明确拒绝。新增 [core/imageinfo.py](file:///workspace/core/imageinfo.py)（纯标准库 PNG/JPEG/GIF/WebP/BMP 头解析）供 v2 元数据回填。

### A.3 一步迁移脚本

[scripts/migrate.py](file:///workspace/scripts/migrate.py) 是通用迁移壳，协调三模块的迁移函数，**一步到最新**：

```bash
python scripts/migrate.py            # dry-run 只报告
python scripts/migrate.py --apply    # 落地（先备份 .bak-<时间戳>，校验通过才保留）
python scripts/migrate.py --apply --rebuild-registry  # 清单损坏按 .assets 文件重建
python scripts/migrate.py --apply --output-root 路径  # 指定别的 output 目录
```

`--apply` 执行顺序（见 [scripts/migrate.py:83-85](file:///workspace/scripts/migrate.py#L83-L85)）：

1. **relocate** `.canvas` → `.assets`（重写 relPath，整目录备份 `.canvas-bak-<ts>`）
2. **upgrade** 注册表 v1→v2（补宽高/格式）
3. **backfill** 来源标签 kind（canvas/result/ref）
4. **upgrade** 工作流 v1→v2（补 version+savedAt）
5. **backfill** 历史账本 outputAssetIds（见 C 节）

**dry-run 预检增强**（commit `f3736b6`）：存量 `.canvas/registry.json` 仍是 v1 时报 `pending-relocate`，不误报 missing；工作流 dry-run 也报 `ready` 字段统计待升级数。

---

## B. 计费/配置收敛（08-22）

### B.1 cost_for_size 唯一入口

[core/config.py:184-192](file:///workspace/core/config.py#L184-L192) 新增 `cost_for_size(size)`：

- 费用**唯一来自** `config.json` 当前 profile 的 `size_options`
- 未知尺寸返回 `0.0`（不硬编码兜底价）
- `server.size_cost` 与 `core/batch.py tier_cost` 均委托此函数

**旧仓库差异**：之前 README 计费表硬编码 0.05/0.10，server 有 `0.10` 魔法数字。现在改价只动 `config.json` 一处。

### B.2 历史与提交联动（C 节详见）

---

## C. 历史与资产联动（08-20 ~ 08-22，4 条 commit）

### C.1 账本字段扩展

[core/logging.py](file:///workspace/core/logging.py) `log_generation` 加可选字段（缺省不写，旧行兼容）：
- `submission_id` — 提交快照 id
- `input_asset_ids` — 参考图资产 id 列表
- `output_asset_ids` — 结果图资产 id 列表

### C.2 历史存在性以注册表为准

[server.py](file:///workspace/server.py) `generation_history`：
- 账本带 `outputAssetIds` 时按 `registry.resolve_asset` 解析（.assets 副本一条永在）
- 旧行（无 assetIds）回退 output 路径 `isfile`

**旧仓库差异**：之前历史存在性只看 output 原路径，移动原文件就丢；现在 .assets 副本永在，移动原文件不丢。

### C.3 历史补齐迁移

[core/history.py:72-94](file:///workspace/core/history.py#L72-L94) `backfill_output_asset_ids`：旧行缺 `outputAssetIds` 时按 output 文件内容 sha1 反查注册表补齐。安全语义与迁移家族一致（默认只报告、apply 才备份+原子写+校验、幂等）。已并入 `scripts/migrate.py --apply` 第 5 步。

### C.4 提交图快照 + 整图导入

[core/graphstore.py](file:///workspace/core/graphstore.py) `submission_save/load`（复用工作流格式 `kind='submission'`）：
- 经典表单生成 done 时旁路落盘 `output/submissions/<submissionId>.json`（图片组→提示词→结果连线）
- 经典结果区「导入画布」= `POST /api/canvas/import-submission` 整图重建
- 前端 [workflow.ts](file:///workspace/frontend/src/workflow.ts) `mergeSubmissionGraph` 按 registryId 去重复用现有图片节点

---

## D. 画布布局与渲染（08-19 ~ 08-23，9 条 commit）

### D.1 布局引擎独立模块

[frontend/src/layout.ts](file:///workspace/frontend/src/layout.ts) 从 `workflow.ts` 拆出（commit `757119f2`），五阶段纯函数管道（commit `4af1a8ad`）：

```
0) 裁剪：参与布局节点 + 未选中"只读锚点"（固定位置参与对齐不移动）
1) 分层：最长路径（环回边不计层）+ 类型保底（孤立图/组 0、提示词 1）
2) 排序：群 = 同参考来源的节点；群内按标题，群间按质心
3) 坐标：forward（前驱质心）→ backward（无前驱节点随后继质心）→ forward 收敛
4) 输出：只改写移动节点位置，其余原样返回
```

**旧仓库差异**：之前 `autoLayout` 固定三段式（图 0/组 1/卡 2/结果 3），结果图被复用或多级链路时乱套。现在多对多网状由双向质心摊平，自底向上定位（卡片→组→图逐层锚定），重复整理幂等不漂移。

### D.2 LOD 抽象渲染 + 视口虚拟化

[CanvasPage.tsx:78-81](file:///workspace/frontend/src/components/CanvasPage.tsx#L78-L81) LOD 阈值：
- `LOD_IN_ZOOM = 0.1` — 缩小到此值以下进入抽象渲染
- `LOD_OUT_ZOOM = 0.2` — 放大到到此值以上恢复完整渲染
- 两值间迟滞带（0.1~0.2）避免抖动

抽象渲染时（[CanvasNodes.tsx:66-112](file:///workspace/frontend/src/components/CanvasNodes.tsx#L66-L112) 图片节点、330-358 提示词节点）：保留缩略图/连接把手/双击放大，去掉操作栏与引用行等重 UI。节点多时不再卡。

### D.3 提示词契约更名

`promptContract` → `promptImportFormat`（commit `151de44b`）：
- [frontend/src/promptImportFormat.ts](file:///workspace/frontend/src/promptImportFormat.ts)（`parsePromptImportFormat`）
- [docs/prompt-import-format.md](file:///workspace/docs/prompt-import-format.md) 替代旧 `prompt-contract.md`
- UI 文案「契约」统一为「导入格式」，旧名零残留

### D.4 自动整理泛化

`ed0fb38e` 把 `autoLayout` 从固定三段式改为最长路径分层，普通三段式恰为其特例。结果图复用（连图片组/别的提示词）或多级链路自动向下延伸，连线只朝下不横穿。

---

## 测试用例数变化

| 仓库状态 | 后端 pytest | 前端 vitest |
|---|---|---|
| 四天前 | ~147 | ~94 |
| 当前 | 174 | 95 |

新增测试文件：[tests/test_core_migrate.py](file:///workspace/tests/test_core_migrate.py)（19 例）、[tests/test_core_imageinfo.py](file:///workspace/tests/test_core_imageinfo.py)（10 例）、[tests/test_core_pathtrust.py](file:///workspace/tests/test_core_pathtrust.py)（2 例）、[frontend/src/layout.test.ts](file:///workspace/frontend/src/layout.test.ts)（来自 workflow.test.ts 拆分）。

---

## 四天前旧仓库迁移步骤

如果你手里是四天前的旧仓库 checkout，要迁到最新并保留数据：

1. **拉最新代码**：`git pull origin main`（或重新 clone）
2. **迁移数据**（你的 output 在默认位置）：
   ```bash
   python scripts/migrate.py            # 先 dry-run 看一眼
   python scripts/migrate.py --apply    # 确认无误再落盘
   ```
3. **output 不在默认位置**：追加 `--output-root 路径`
4. **清单已损坏**：`python scripts/migrate.py --apply --rebuild-registry`

`--apply` 一步完成：迁目录 + 升级注册表 + 回填 kind + 升级工作流 + 补历史 outputAssetIds。幂等可重复执行，每步先备份再原子写、写后加载器读回校验。

---

## 关键文件速查

| 文件 | 用途 |
|---|---|
| [scripts/migrate.py](file:///workspace/scripts/migrate.py) | 迁移壳（协调三模块） |
| [core/registry.py](file:///workspace/core/registry.py) | 资产注册表 + `migrate`/`detect_registry` |
| [core/graphstore.py](file:///workspace/core/graphstore.py) | 工作流 + `migrate_workflows` |
| [core/history.py](file:///workspace/core/history.py) | 历史 + `backfill_output_asset_ids` |
| [core/imageinfo.py](file:///workspace/core/imageinfo.py) | 图片头解析（v2 元数据） |
| [core/config.py](file:///workspace/core/config.py) | `cost_for_size` 唯一计费入口 |
| [frontend/src/layout.ts](file:///workspace/frontend/src/layout.ts) | 五阶段布局引擎 |
| [frontend/src/promptImportFormat.ts](file:///workspace/frontend/src/promptImportFormat.ts) | 提示词导入格式解析 |
| [docs/prompt-import-format.md](file:///workspace/docs/prompt-import-format.md) | 导入格式模板 |

更详细的架构与防错规范见 [ARCHITECTURE.md](file:///workspace/ARCHITECTURE.md)，跨会话交接见 [.omo/CONTEXT.md](file:///workspace/.omo/CONTEXT.md)。
