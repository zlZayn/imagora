# 架构说明

## 设计哲学

- **配置分离**：API Key、接口地址、尺寸映射集中在 `core/config.py`，代码不出现明文密钥
- **职责单一**：一个模块一个职责（config 管配置、api 管请求、batch 管批量、server 管 HTTP、frontend 管界面）
- **产物与代码分离**：生成图片落到各产品目录的 `output/`，不进代码库
- **按名管理**：每个产品一个目录，素材/输出/批量配置随产品走，工具代码跨产品共享
- **类型安全**：前端 TypeScript 严格模式，API 响应全部类型化，参数不会传错

## 架构分层

```
浏览器 (React SPA)
   │  fetch /api/*
   ▼
FastAPI (server.py) ── 托管 frontend/dist 静态产物
   │  core.api.generate_image
   ▼
A站生图 API (2api.aiwanwu.cc)
```

前端开发与生产分离：
- 开发：`npm run dev`（Vite 热更新，/api 代理到后端 7860）
- 生产：`npm run build` 出 dist，FastAPI `StaticFiles` 托管，单端口

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `core/config.py` | 配置中心：API Key（环境变量/.env）、BASE_URL、RATIOS、默认参数 |
| `core/api.py` | 生图请求封装：`generate_image`（文生图/图生图） |
| `core/batch.py` | 批量编排：`run_batch_generation`（读配置、逐张调用、失败容错） |
| `server.py` | FastAPI：`/api/config` `/api/select-folder` `/api/generate` `/api/image` + 静态托管 |
| `main.py` | CLI 入口：`handle_ui/batch/gen_command` 三个子命令 |
| `frontend/src/api.ts` | 前端 fetch 封装（类型化） |
| `frontend/src/components/` | UploadZone(上传) / FolderPicker(路径) / Gallery(画廊) |

## 关键决策

- **API Key**：环境变量 `AIWANWU_API_KEY` 或 `tools/.env`，`.env` 已 git 忽略。未配置时抛清晰错误
- **批量路径基准**：`batch_prompts.json` 中的 `assets/`、`output/` 相对该文件所在目录，配置随项目走
- **尺寸档位**：1K=0.05 / 2K=0.10 / 4K=0.20，尺寸选项由后端 `/api/config` 下发，前端不硬编码
- **图片回显**：生成后通过 `GET /api/image?path=` 读取（生成时返回带 URL 的结果），本地单机工具，路径校验为已存在文件
- **上传底图**：图生图底图落临时文件，结果写输出目录，不污染输出
- **超时**：生成请求 300 秒（图生图 + 2K 可能耗时 1-2 分钟）
