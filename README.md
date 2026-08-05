# A站生图工具

基于 OpenAI 兼容中转站 `2api.aiwanwu.cc` 的生图工具集，文生图 / 图生图一体。
网店商品图、详情页图的批量化生成。

## 目录结构

```
网店实习/
├── tools/                 # 生图工具（本仓库）
│   ├── main.py            # 统一入口
│   ├── core/              # 核心逻辑：config(配置) / api(生图) / batch(批量)
│   ├── ui/                # Gradio 网页界面
│   ├── pyproject.toml     # 依赖管理（uv）
│   └── .env.example       # API Key 配置模板
└── 产品名/                # 每个产品一个目录，按名管理
    ├── assets/            # 产品素材（实拍图、参考图）
    ├── output/            # 生成图片（按模块分子目录）
    └── batch_prompts.json # 该产品的批量生图配置
```

## 首次使用：设置 API Key（必做）

二选一，推荐方式 1（一劳永逸）：

**方式 1：.env 文件**（推荐）

```powershell
Copy-Item tools\.env.example tools\.env
# 然后编辑 tools\.env，把 Key 填进去
#   AIWANWU_API_KEY=sk-你的Key
```

**方式 2：环境变量**（仅当前终端生效）

```powershell
$env:AIWANWU_API_KEY = "sk-你的Key"
```

注意事项：
- `.env` 已被 git 忽略，不会泄露；`tools/.env.example` 只是模板
- 未设置 Key 时会报错并提示怎么配，不会静默失败
- 换 Key 只改 `.env` 一处

## 快速开始

```powershell
# 安装依赖（首次）
cd tools && uv sync

# 网页界面（拖拽/粘贴传图，浏览器打开 http://127.0.0.1:7860）
python tools/main.py ui

# 批量生图（预览不花钱）
python tools/main.py batch --config 薄荷脑皮肤抑菌乳膏/batch_prompts.json --dry-run
python tools/main.py batch --config 薄荷脑皮肤抑菌乳膏/batch_prompts.json

# 单张生图
python tools/main.py gen "a red apple on white background" -o out.png
python tools/main.py gen "换背景" -i 参考图.png --ratio 9:16
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
- 批量配置（`batch_prompts.json`）里的 `assets/`、`output/` 是相对该配置文件所在目录的
