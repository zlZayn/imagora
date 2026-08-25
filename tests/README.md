# tests/ — 测试层（pytest 后端 + vitest 前端）

FastAPI 路由级 + 纯逻辑测试，**不调真实上游 API、不花钱**。前端测试同前端仓库（`frontend/src/*.test.ts*`）。

## 本地常用命令（在项目根目录执行）

```powershell
# 后端全量（207 用例）
.\.venv\Scripts\python.exe -m pytest --basetemp=<ASCII 临时目录>
# 按模块筛选
.\.venv\Scripts\python.exe -m pytest tests/test_core_config.py tests/test_server_helpers.py --basetemp=<ASCII 临时目录>
# 前端（frontend/ 目录内）
cd frontend; npm test
```

## 该目录特有坑

- **必须 `--basetemp=<ASCII 临时目录>`**：工作目录含中文，不指定会触发 tmp_path 挂死（已知问题，勿忘）
- **5 个 Windows 专属测试**：netstat 端口探测 / powershell 父进程链 / C: 绝对路径 / 跨盘相对化——只在 Windows 通过；CI 相关 Job 必须 `windows-latest`
- 路由测试直接 `from server import ...`（import 即建 FastAPI app，属预期）
- **测试数字是 AGENTS 仪表盘数据源**：增/删测试用例必须同步 AGENTS「当前仪表盘」；数字意外变化（非新增导致）必须报告维护者

## 文件索引（后端 pytest，共 207）——每个 test_*.py 测什么

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| [`test_core_api.py`](test_core_api.py) | 18 | 尺寸解析 / 默认输出路径（并发唯一）/ 错误格式化 / 写文件瞬时锁重试 |
| [`test_core_batch.py`](test_core_batch.py) | 10 | 配置读取 / 路径解析 / 模块过滤 / dry-run |
| [`test_core_config.py`](test_core_config.py) | 15 | API Key 跟随 profile / profile 解析优先级与缺失回退 / 白名单校验 / RATIOS 表结构 |
| [`test_core_logging.py`](test_core_logging.py) | 8 | 日志写入 / 并发串行 / 路径相对化 |
| [`test_core_history.py`](test_core_history.py) | 7 | 历史读取 / 坏行容忍 / 筛选 / backfill（报告·补齐·幂等·跳过无法反查·坏行保留） |
| [`test_core_canvas.py`](test_core_canvas.py) | 32 | 注册表（v2+v1 兼容）/ 内容去重 / import 边界 / kind 来源标签 / workflow 归一化与自愈 / recovery / submission / persist_submission_assets |
| [`test_core_imageinfo.py`](test_core_imageinfo.py) | 10 | PNG/JPEG/GIF/WebP/BMP 头解析 / 垃圾与截断返回 None |
| [`test_core_migrate.py`](test_core_migrate.py) | 19 | 注册表 detect/升级/重建/回填/迁目录 / 工作流升级 / CLI 端到端 |
| [`test_core_tasks.py`](test_core_tasks.py) | 11 | 任务状态机 / 并发上限 / 取消 / 快照 / TTL 清理 |
| [`test_core_pathtrust.py`](test_core_pathtrust.py) | 2 | 路径白名单（match_roots 双根/单根/跨盘） |
| [`test_server_helpers.py`](test_server_helpers.py) | 20 | 窗口分配 / 安全路径白名单 / upload-ref / delete-ref / generate 同步性 / history 注册表解析 / 导入与展示同源 |
| [`test_server_canvas.py`](test_server_canvas.py) | 18 | canvas 路由 / workflow 往返（v2）/ missing 收集 / ref_paths 放行 |
| [`test_server_tasks.py`](test_server_tasks.py) | 8 | generate 提交即返回 / multipart 临时文件清理 / 保存消息为绝对路径 / 路径校验 / 任务路由 |
| [`test_main_process.py`](test_main_process.py) | 4 | 端口探测 / 祖先链回溯（Windows） |
| [`test_main_cli.py`](test_main_cli.py) | 25 | CLI gen 子命令全链路（校验/输出解析/文生图+图生图+多参考/失败/--no-asset/比例档位）/ config 输出 |

## 文件索引（前端 vitest，共 137，位于 frontend/src/）

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| [`layout.test.ts`](../frontend/src/layout.test.ts) | 29 | 分层布局 / 复杂连接 / 局部整理不漂移 / 多对多摊平 |
| [`workflow.test.ts`](../frontend/src/workflow.test.ts) | 31 | 自动连线 / 动画类 / 连线约束 / 落点阶梯 / 节点构建器 |
| [`canvasDrop.test.ts`](../frontend/src/canvasDrop.test.ts) | 14 | 拖拽意图解析 / 文件识别 / 数量统计 / 示意文案 / isInsideRect |
| [`previewZoom.test.ts`](../frontend/src/previewZoom.test.ts) | 5 | 缩放范围 / 平移夹紧 |
| [`canvasHistory.test.ts`](../frontend/src/canvasHistory.test.ts) | 2 | 撤销 / 恢复 / 新分支清空 |
| [`canvasStyles.test.ts`](../frontend/src/canvasStyles.test.ts) | 4 | 动效 CSS 选择器约束 |
| [`recovery.test.ts`](../frontend/src/recovery.test.ts) | 4 | 快照剥离动画类 / 运行期字段清除 |
| [`useGenerationTask.test.ts`](../frontend/src/useGenerationTask.test.ts) | 2 | hook 稳定成员引用 |
| [`useImageZoom.test.ts`](../frontend/src/useImageZoom.test.ts) | 4 | 单击开原图 / 双击放大时序（fake timers）/ 卸载清理 |
| [`logPath.test.ts`](../frontend/src/logPath.test.ts) | 6 | 日志路径词条解析（绝对/相对、正反斜杠、多路径、扩展名大小写） |
| [`CanvasNodes.test.tsx`](../frontend/src/components/CanvasNodes.test.tsx) | 10 | 节点操作栏 / 双击行为 |
| [`ResultPanel.test.tsx`](../frontend/src/components/ResultPanel.test.tsx) | 7 | 结果区 5 态面板 / 切换交叉淡化（旧层保留至淡出移除） |
| [`promptImportFormat.test.ts`](../frontend/src/promptImportFormat.test.ts) | 19 | 导入格式解析容错 / 尺寸映射 / 建卡 |

## 变更影响路由（改前必看）

- 改 `core/registry.py` / `graphstore.py` → `test_core_canvas.py` + `test_core_migrate.py` + 相关 server 测试
- 改 `core/config.py` → `test_core_config.py`（新增 profile 键必须同步白名单测试）
- 改 `core/history.py` → `test_core_history.py` + `test_server_helpers.py`（展示/导入同源）
- 改 `core/api.py` → `test_core_api.py` + `test_main_cli.py`
- 改 `server.py` 路由 → 对应 `test_server_*.py` + 前端 `types.ts`/`api.ts`
- 改前端纯函数 → 对应 `*.test.ts`（同目录同名）
- 改前端组件 → 组件单测 + E2E（`../frontend/e2e/verify_canvas.py`，36 断言）
- **增/删用例后更新 AGENTS「当前仪表盘」数字**

## CI 要求

- Backend Job：**windows-latest**（5 个 Windows 专属测试）
- `--basetemp` 指向 ASCII 临时目录（本地自选目录，CI 用 `${{ runner.temp }}`，见 ci.yml）
- 细节见 [../.github/workflows/ci.yml](../.github/workflows/ci.yml)（草稿）

## 参考

- 测试规范与数字口径：[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 10
- 被测模块手册：[../core/README.md](../core/README.md)、[../frontend/README.md](../frontend/README.md)
- 维护仪表盘（数字/待办/坑）：[../AGENTS.md](../AGENTS.md)