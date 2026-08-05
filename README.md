# A站生图工具

基于 OpenAI 兼容中转站 `2api.aiwanwu.cc` 的生图工具。文生图 / 图生图一体，网店商品图、详情页图批量化生成。

## 架构

- 后端：FastAPI（`server.py`），复用 `core/` 生图逻辑
- 前端：Vite + React + TypeScript + Tailwind（`frontend/`），构建产物由 FastAPI 托管，单端口运行
- 依赖管理：uv（Python）、npm（前端）

## 目录结构

```
tools/
├── main.py            # 入口：ui / batch / gen 子命令
├── server.py          # FastAPI 后端：/api/* 路由 + 托管前端产物
├── core/              # 核心逻辑：config(配置) / api(生图) / batch(批量)
├── frontend/          # React 前端（npm run dev 开发 / npm run build 产物）
├── pyproject.toml     # Python 依赖（uv）
├── .env / .env.example
└── 启动生图工具.cmd   # 双击启动：首次自动构建前端
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
# 方式 A：双击 tools\启动生图工具.cmd（首次自动 npm install + build，然后启动并开浏览器）
# 方式 B：命令行
cd tools
uv sync                                      # 安装 Python 依赖
cd frontend; npm install; npm run build; cd ..   # 构建前端（首次）
uv run python -m main ui                     # 启动 http://127.0.0.1:7860

# 前端开发模式（改样式热更新，需后端已启动）
cd frontend; npm run dev                     # http://localhost:5173

# 批量生图（预览不花钱）
uv run python -m main batch --config ..\薄荷脑皮肤抑菌乳膏\batch_prompts.json --dry-run

# 单张生图
uv run python -m main gen "a red apple on white background" -o out.png
```

## 计费（A站）

| 档位 | 分辨率示例 | 单张价格 |
| --- | --- | --- |
| 1K | 1024x1024 | 0.05 |
| 2K | 1152x2048 等 | 0.10 |
| 4K | 3840x2160 | 0.20 |

其他注意：
- 生成需 30-120 秒，接口超时已放宽至 300 秒
- 提示词英文优先，减少歧义
- 批量配置里的 `assets/`、`output/` 相对该配置文件所在目录
