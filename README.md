# A站生图工具

基于 OpenAI 兼容中转站 `2api.aiwanwu.cc` 的生图工具。文生图 / 图生图一体，网店商品图、详情页图批量化生成。

## 它能做什么

- 网页界面一键生图：拖拽 / 粘贴 / 点击上传参考图（可多张，每张即时标注**文件名与大小**），输入提示词即出图
- 文生图与图生图自动切换：不传图 = 文生图，传图 = 图生图（可传多张参考图，用途由提示词决定）
- 多开页面并行生图：一个服务开多个窗口，自动编号互不冲突（见「多开页面」）
- 生成结果实时显示：每张图标注**分辨率、格式、文件大小与费用**，底部汇总**本次总费用与用时**
- 输出目录自由选择：手输路径或系统文件夹选择器，生成后一键"打开文件夹"定位
- 批量生图：按产品配置一次生成多张详情页图（预览模式不花钱）
- 命令行单张生图：适合脚本化调用

## 架构概览

- 后端：FastAPI（`server.py`）+ 核心逻辑 `core/`（配置 / 生图 / 批量 / 日志）
- 前端：Vite + React + TypeScript + Tailwind（`frontend/`），构建产物由 FastAPI 托管，单端口运行
- 依赖管理：uv（Python）、npm（前端）

## 目录结构

```
tools/
├── main.py            # 入口：ui / batch / gen 子命令
├── server.py          # FastAPI 后端：/api/* 路由 + 托管前端产物
├── core/              # 核心逻辑：config(配置) / api(生图) / batch(批量) / logging(日志)
├── frontend/          # React 前端（npm run dev 开发 / npm run build 产物）
├── tests/             # 单元测试（纯函数零成本）
├── logs/              # 生成日志（git 忽略）：每次生图记录提示词/结果/费用/耗时
├── pyproject.toml     # Python 依赖（uv）
├── .env / .env.example
└── 启动生图工具.cmd   # 双击启动（首次需先构建前端，见快速开始）
```

## 首次使用：设置 API Key（必做）

二选一，推荐方式 1：

**方式 1：.env 文件**（推荐）

```powershell
Copy-Item tools\.env.example tools\.env
# 编辑 tools\.env，填入：AIWANWU_API_KEY=sk-你的Key
```

**方式 2：环境变量**（仅当前终端生效）

```powershell
$env:AIWANWU_API_KEY = "sk-你的Key"
```

注意：`.env` 已 git 忽略，不会泄露；未设置 Key 时调用生图会明确报错。

## 快速开始

```powershell
# 方式 A（推荐）：先按下面「方式 B」构建一次前端，之后双击 tools\启动生图工具.cmd 即可
# 方式 B：命令行
cd tools
uv sync                                      # 安装 Python 依赖
cd frontend; npm install; npm run build; cd ..   # 构建前端（仅首次）
uv run python -m main ui                     # 启动 http://127.0.0.1:7860
uv run python -m main ui --port 8080         # 换端口

# 前端开发模式（改样式热更新，需后端已启动）
cd frontend; npm run dev                     # http://localhost:5173

# 批量生图（预览不花钱）
uv run python -m main batch --config ..\薄荷脑皮肤抑菌乳膏\batch_prompts.json --dry-run

# 单张生图
uv run python -m main gen "a red apple on white background" -o out.png

# 运行测试（零成本，不调 API）
uv run pytest
```

## 多开页面（并行生图）

服务只需启动一次即可多窗口并行生图，互不冲突。启动脚本 `启动生图工具.cmd` 自带快捷键：

- 启动后菜单按 **N** → 自动开下一个编号窗口（服务端分配编号，绝不撞号）
- 按 **Q** → 停止本脚本启动的服务并退出（不影响其他方式启动的服务）
- 窗口顶栏显示「窗口 #N」，默认输出按窗口分区 `output/win{N}`
- 每个窗口**主色按编号自动区分**（编号不同颜色不同、同编号刷新不变），多开一眼可辨
- 页面内「＋ 新窗口」按钮：**继承当前窗口的上传图片 / 尺寸 / 质量 / 输出路径**（图片在添加时已存入服务端，新窗口只传引用、秒开即见，不受浏览器存储上限影响），仅提示词不保留，方便多角度批量出图；命令行 `?win=` 打开则保持全新
- 也可手动指定 `http://127.0.0.1:7860/?win=5`
- 同秒并发生成文件名不冲突；生成日志（`logs/generation.jsonl`）带窗口号，可按窗口溯源

## 计费（A站）

| 档位 | 分辨率示例 | 单张价格 |
| --- | --- | --- |
| 1K | 1024x1024 | 0.05 |
| 2K | 1152x2048 等 | 0.10 |
| 4K | 3840x2160 | 0.20 |

其他注意：
- 生成需 30-120 秒，接口超时已放宽至 300 秒
- 提示词英文优先，减少歧义
- API Key 未配置时，界面顶部会显示黄色提示条
