# Imagora

AI 生图工作台：OpenAI 兼容接口，文生图 / 图生图一体。面向网店商品图、详情页图批量生成，支持无限画布工作流编排。

## 它能做什么

| 场景 | 说明 |
| --- | --- |
| 网页一键生图 | 拖拽 / 粘贴 / 点击上传参考图（可多张）；不传图 = 文生图，传图 = 图生图 |
| 多窗口并行 | 一个服务开多个窗口，自动编号，互不冲突 |
| 结果实时显示 | 每张图标注分辨率、格式、大小与费用；底部汇总总费用与用时 |
| 输出目录自由 | 手输路径或文件夹选择器，生成后一键打开 |
| 批量生图 | 按产品配置一次生成多张，任务预览 + 进度条，预览不花钱 |
| 命令行生图 | 与网页表单完全对等，参数显式指定 |
| 无限画布 | 图片 / 提示词编排，连线即参考，结果回流迭代（见「画布工作流」） |
| 提示词粘贴导入 | 多模态模型按格式返回整段提示词，粘入画布批量建卡 |

> 提示词导入格式（发给多模态模型的输出规范）见 [docs/prompt-import-format.md](docs/prompt-import-format.md)；电商商品图专用模板（固定轮播/详情顺序）见 [docs/ecom-prompt-import-format.md](docs/ecom-prompt-import-format.md)。

## 快速开始

### 1. 设置 API Key（必做）

二选一，推荐 `.env`：

```powershell
Copy-Item Imagora\.env.example Imagora\.env
# 编辑 Imagora\.env，填入：API_KEY_WANWU=sk-你的Key
```

或环境变量（仅当前终端生效）：

```powershell
$env:API_KEY_WANWU = "sk-你的Key"
```

- `.env` 已 git 忽略，不会泄露；未设 Key 时调用生图会报错，界面顶部显示黄色提示条
- 旧写法 `AIWANWU_API_KEY` 仍兼容；多供应商 key 命名见「切供应商（profiles）」

### 2. 启动

```powershell
cd Imagora
uv run python -m main ui --port 8080         # 换端口启动
cd Imagora/frontend; npm run dev             # 前端开发模式（热更新，需后端已启动）
```

双击 `启动生图工作台.cmd` 也可：脚本自动检查前端构建 → 起服务 → 开窗 → 进交互菜单。

### 3. 常用命令速查

| 命令 | 用途 |
| --- | --- |
| `uv run python -m main gen "a red apple" --size 1024x1024 --quality high -o out.png` | 单张生成 |
| `uv run python -m main batch --config <目录>\batch_prompts.json --dry-run` | 批量（预览不花钱） |
| `uv run python -m main config` | 查看当前 profile 支持的尺寸 / 比例 / 质量 |

测试、lint、E2E 等开发命令见 [AGENTS.md](AGENTS.md)「验证状态」。

## 命令行（CLI）

`gen` 与网页表单完全对等，产物进历史账本、与网页端同源可互查。

### gen 单张生成

**必填参数**（缺一即报错，退出码 2，并提示运行 `config`）：

| 参数 | 说明 |
| --- | --- |
| `prompt`（位置参数） | 提示词，英文优先 |
| `--size` 或 `--ratio` | 二选一：分辨率（`1024x1024`）或宽高比（`9:16`） |
| `--quality` | `low` / `medium` / `high`（可用值见当前 profile） |
| `--output` / `-o` | 输出路径（目录则自动生成 `ai_<时间戳>_<序号>.<后缀>`） |

**可选参数**：

| 参数 | 说明 |
| --- | --- |
| `-i` / `--image` | 参考图路径，可多次传（传了即图生图） |
| `--tier` | 配合 `--ratio` 的档位：`1K` / `2K` / `4K`（默认 `2K`） |
| `--model` | 模型名（默认当前 profile） |
| `--n` | 生成张数（默认 1） |
| `--format` | `png` / `jpg` / `webp`（默认 `png`；输出路径带后缀时以后缀为准） |
| `--no-asset` | 跳过资产注册与历史记录（纯生成） |

CLI 单次同步等待结果；多张并行 = 开多个终端各跑一条。

### config 查看支持值

```powershell
uv run python -m main config
# 当前 profile: wanwu  ·  模型: gpt-image-2  ·  端点: https://2api.aiwanwu.cc
# 默认尺寸: 1024x1024  ·  默认质量: high  ·  默认档位: 2K
# 尺寸 SIZE_OPTIONS:  1024x1024 (1:1, 0.05 元) ...
# 比例 RATIOS:        9:16 → 2K=1152x2048 / 4K=2160x3840 ...
# 质量 QUALITY_OPTIONS: low / medium / high
```

## 切供应商（profiles）

多套供应商配置并存、一行切换，不用改代码：

- **公开配置**（地址 / 模型 / 尺寸 / 质量 / 比例）在 `config.json`（git 跟踪）：`default_profile` 指定默认，`profiles` 可放多套（示例含 `wanwu` 与 `other`，后者为占位需自行替换）
- **密钥与本机覆盖**在 `.env`（git 忽略）：key 按 `API_KEY_<大写 profile 名>` 命名（如 `API_KEY_WANWU`），切换时自动跟随；旧写法 `AIWANWU_API_KEY` 兼容
- **优先级**：环境变量 / `.env` 的 `ACTIVE_PROFILE` > `config.json` 的 `default_profile` > 内置默认

三种场景：

1. 个人临时切站：`.env` 加 `ACTIVE_PROFILE=other` + `API_KEY_OTHER=sk-...`，重启生效
2. 团队换默认供应商：改 `config.json` 的 `default_profile` 并提交，pull 后生效
3. 新机器初始化：`cp .env.example .env` → 填 Key → 其余默认即可用

切换后标题栏显示「profile · 模型」徽章，一眼确认；配置写错会控制台警告并回退默认，不静默出错。

## 多开页面（并行生图）

服务启动一次即可多窗口并行，互不冲突。双击脚本启动后进入彩色交互菜单：

- 菜单实时显示服务地址 / PID / 已分配窗口编号
- **N** → 开下一个编号窗口（服务端分配，绝不撞号）；**Q**（或关窗 / Ctrl+C）→ 连根停掉端口上全部服务进程并退出
- 手动直达：`http://127.0.0.1:7860/?win=5`

窗口行为：

- 顶栏「窗口 #N」，主题色 + 标签页图标按编号区分
- 默认优先上次输出路径（重启沿用），无记录则按窗口分区 `output/win{N}`
- 页内「＋ 新窗口」继承当前窗口的上传图 / 尺寸 / 质量 / 输出路径（提示词不保留）
- 同秒并发文件名不冲突；日志带窗口号可溯源

## 画布工作流（无限画布）

顶部「经典表单 / 无限画布」切换，或直达 `http://127.0.0.1:7860/?mode=canvas`。

### 元素与连线

- 三类节点：图片（缩略图）、图片组（聚合多图）、提示词（文案 / 尺寸 / 质量 / 输出路径 / 运行按钮）
- 连线 = 参考关系：图片连到提示词 = 该图作为此任务参考图
- 类型硬约束：图片→提示词/图片组、图片组→提示词、提示词→结果；连错拒绝；提示词顶部仅一条入边
- 图片可复用：一张图可连多个提示词；画布上同一文件只有一个节点

### 生成与结果

- 独立任务：每个提示词节点独立生成，「运行」只带自己的入边图，「全部运行」提交到服务端并发队列
- 状态灯：排队琥珀 / 生成中呼吸闪烁 / 完成绿 / 失败红（悬停看原因）
- 结果回流：结果自动变新图片节点（提示词正下方），可继续连线迭代
- 统一存储：经典表单与画布同一后端存储，经典结果可「导入画布」整图还原

### 操作

- 拖拽本地图片（可多张）到画布松开即添加；新建卡片 / 图片组按钮可拖出到画布松开即建（点击仍居中）
- 右键框选 / Ctrl+点击加选 → 操作栏：运行所选、自动整理、自动连线、设输出路径、删除所选
- 双击图片开预览（滚轮缩放、拖拽平移、双击复位）；双击连线删除；画布内右键不弹浏览器菜单
- 缩到很小视图节点变抽象卡片（只影响渲染）

**快捷键**：`Ctrl+A` 全选 · `Ctrl`+点击加选 · `Ctrl+Z/Y` 撤销恢复 · `Ctrl+S` 保存 · `Delete` 删除（输入框聚焦时不拦截）

### 保存与迁移

- 画布存为 JSON 工作流随时还原；项目改名 / 移动后旧工作流仍可恢复
- 数据版本化（v1/v2 自动兼容）；迁移 / 清单修复用 `scripts/migrate.py`，属维护向操作，见 [ARCHITECTURE.md](ARCHITECTURE.md) 第 5.5 节

## 计费说明

- 计费与尺寸由 `config.json`（当前 profile 的 `size_options[].cost`）统一管理，无硬编码价格
- 界面尺寸下拉经 `/api/config` 实时下发；命令行 `gen --tier 4K` 按档位请求高分辨率，费用按对应档位结算
- 生成 30-120 秒（接口超时放宽至 300 秒）；提示词英文优先，减少歧义

## 更多

- 技术细节、模块依赖、API 契约、关键决策：见 [ARCHITECTURE.md](ARCHITECTURE.md)
- 维护交接、验证状态、待办、已知问题：见 [AGENTS.md](AGENTS.md)