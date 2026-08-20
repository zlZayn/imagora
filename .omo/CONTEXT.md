# 上下文交接文档（CONTEXT）

> 维护约定：本文件随工作进展持续更新，记录跨会话交接所需的关键事实——当前工作、架构决策、验证状态、已知问题。交接时先读这里。

## 当前工作（2026-08-13，画布存储格式版本化 v2 + 独立迁移脚本）

**存储格式升级为 v2（注册表/工作流），v1/v2 兼容读取、老数据零失效；`scripts/migrate_canvas_v2.py` 一键迁移；后端 147 用例全绿。**

- **格式版本化**：注册表 v2 包装 `{schemaVersion: 2, images: {id: entry}}`（v1 裸 dict 兼容读取）；工作流 v2 = `version: 2` + `savedAt`（v1 读取兼容；未知版本明确拒绝防按错结构解析未来格式）；手动保存工作流改原子写
- **注册表条目附可选宽高/格式**：`core/imageinfo.py` 纯标准库解析图片头（PNG/JPEG/GIF/WebP/VP8/VP8L/VP8X/BMP），失败不带字段（宽兼容）
- **迁移脚本** `scripts/migrate_canvas_v2.py`（独立、提交远程）：纯逻辑在 `core/migrate.py`（10 单测）——默认只报告；`--apply` 才落地且先备份 `.bak-<时间戳>`、写后加载器读回校验；`--rebuild-registry` 清单缺失/损坏时按 `.canvas` 文件重建 v2；幂等、非破坏（已端到端演练验证）

> 此前画布拖拽（useCanvasDrop/canvasDrop/光标/自动整理分层/上传过滤/连线 hover）已提交，历史见 git 与旧 CONTEXT 记录。

## 已完成的代码改动（本轮）

| 文件 | 内容 |
|---|---|
| `core/canvas.py` | 注册表 v2 包装 + v1 兼容读取；工作流 v2（savedAt）+ 版本表加载+未知版本拒绝；手动保存原子写；条目附宽高/格式 |
| `core/imageinfo.py` | 新增：图片头解析（纯标准库，零依赖） |
| `core/migrate.py` | 新增：v1→v2 升级 / 清单重建 / 备份→转换→校验→报告（默认只报告） |
| `scripts/migrate_canvas_v2.py` | 新增：独立迁移脚本（--apply / --rebuild-registry / --output-root） |
| `tests/test_core_imageinfo.py` | 新增 10 用例 |
| `tests/test_core_migrate.py` | 新增 10 用例 |
| `tests/test_core_canvas.py` / `test_server_canvas.py` | 适配 v2（版本断言、v1 兼容、未知版本拒绝） |
| `ARCHITECTURE.md` / `README.md` / `.omo/CONTEXT.md` | 存储版本化 + scripts/ + 测试表 + 老档兼容说明 |

## 历史工作（已提交，仅备忘）

- 多 profile 动态配置（config.json + core/config.py + /api/config 返回 baseUrl/defaultModel/activeProfile）：详情见 git 历史与 ARCHITECTURE 4.4、README「切换中转站」
- 上一轮技术债扫描结论：代码级零债（无 TODO/ts-ignore、pyflakes 零告警、严格 tsconfig、eslint-disable 均有正当注释）

## 验证状态（本轮）

| 检查 | 结果 |
|---|---|
| 前端 tsc / build | 通过 |
| 前端 lint | 零告警 |
| 前端 test | 94 passed（原 73 + 21；含 canvasDrop 11、复杂连接分层 5） |
| 后端 pytest | **147 passed**（原 126 + 21：imageinfo 10 / migrate 10 / canvas v2 兼容 1） |
| 后端 ruff | `uv run ruff check .` 零告警 |
| E2E verify_canvas.py | **31/31 PASS**（含真实鼠标拖拽、拖到 UI 区域落点夹紧）；venv 已装 playwright + chromium headless |

> E2E 运行方式：起服务（`.venv\Scripts\python.exe -m main ui --no-browser --port 7860`）后另开终端 `.venv\Scripts\python.exe frontend\e2e\verify_canvas.py`。拖拽断言用 DataTransfer + DragEvent 模拟（文件内容用 `crypto.getRandomValues` 防注册表去重影响重复运行）。

## 已知问题

- `server.py:583` LSP 报 "Argument missing for parameter id" 是**误报**（`GenerationTask.id` 有 `default_factory`），pre-existing，勿修
- E2E 已用 Playwright 真实鼠标事件覆盖工具栏按钮的原生 HTML5 DnD；文件拖拽仍以合成 `DataTransfer` 模拟（OS 文件拖拽无法在 headless 复现），Windows 资源管理器拖文件建议人工体验一次

## 下一步

- 可选增强（非阻塞）：画布 Ctrl+V 粘贴图片（经典表单已有该能力，画布暂未接）；落点示意文案 i18n
