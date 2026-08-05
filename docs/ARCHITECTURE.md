# 架构说明

## 设计哲学

- **配置分离**：API Key、接口地址、尺寸映射集中在 `core/config.py`，代码不出现明文密钥
- **职责单一**：一个模块一个职责（config 管配置、api 管请求、batch 管批量、ui 管界面）
- **产物与代码分离**：生成图片落到各产品目录的 `output/`，不进代码库
- **按名管理**：每个产品一个目录，素材/输出/批量配置随产品走，工具代码跨产品共享

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `core/config.py` | 配置中心：API Key（环境变量/.env）、BASE_URL、RATIOS、默认参数 |
| `core/api.py` | 生图请求封装：`generate_image`（文生图/图生图） |
| `core/batch.py` | 批量编排：`run_batch_generation`（读配置、逐张调用、失败容错） |
| `ui/app.py` | Gradio 界面：`launch_ui`、`generate_and_save` |
| `main.py` | CLI 入口：`handle_ui/batch/gen_command` 三个子命令 |

## 调用链

```
main.py --ui--> ui/app.py:launch_ui
main.py --batch--> core/batch.py:run_batch_generation --> core/api.py:generate_image
main.py --gen--> core/api.py:generate_image
                 core/config.py:get_api_key（读 .env / 环境变量）
```

## 关键决策

- **API Key**：环境变量 `AIWANWU_API_KEY` 或 `tools/.env`，`.env` 已 git 忽略。未配置时抛清晰错误
- **批量路径基准**：`batch_prompts.json` 中的 `assets/`、`output/` 相对该文件所在目录，配置随项目走
- **尺寸档位**：1K=0.05 / 2K=0.10 / 4K=0.20，`RATIOS` 表给出比例到合法分辨率的映射
- **超时**：生成请求 300 秒（图生图 + 2K 可能耗时 1-2 分钟）
