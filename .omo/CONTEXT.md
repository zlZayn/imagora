# 上下文交接文档（CONTEXT）

> 维护约定：本文件随工作进展持续更新，记录跨会话交接所需的关键事实——当前工作、架构决策、验证状态、已知问题。交接时先读这里。

## 当前工作（2026-08-13，动态配置系统）

**多 profile 配置方案已完成并全量验证通过（后端 126 用例 / 前端 73 / ruff 零告警 / 服务实测），已提交推送。**

- `config.json`（git 跟踪）：多 profile（wanwu 完整 + other 示例），`default_profile` 为公共默认
- `core/config.py`：分层加载（环境变量/.env > profiles[ACTIVE_PROFILE] > default_profile > 内置默认）；纯函数 `resolve_profile_config` / `unknown_profile_keys`（白名单校验防 typo）；`get_api_key()` 按 `API_KEY_<PROFILE>` → `API_KEY` → `AIWANWU_API_KEY` 跟随切换，旧写法零改动
- `server.py`：`/api/config` 返回 baseUrl / defaultModel / activeProfile
- 前端：`types.ts` 补三个可选字段；标题栏新增「profile · 模型」徽章，切换后一眼确认生效
- `.env.example` / README（「切换中转站」章节）/ ARCHITECTURE（4.4 配置加载层 / API 表 / 防错清单条目）同步

> 技术债扫描（全库）：代码级零债（无 TODO/ts-ignore、pyflakes 零告警、严格 tsconfig、依赖全部在用、3 处 eslint-disable 均有正当注释）；唯一发现 ARCHITECTURE 测试表数字漂移（113→126、缺 test_core_tasks/server_tasks 两行、config 4→14）已修复；pytest-asyncio 是环境残留非项目依赖，无需声明。
> 文档质量：README 已按「克制、清晰、必要信息」标准收敛——画布章节删实现细节（双层守卫/registryId/存储路径/动效数值），key 示例与 .env.example 统一为 API_KEY_WANWU，多开章节去重。

## 方案讨论记录

### 用户需求

换中转站时不想改代码，想通过配置文件切换。

### 讨论过程

1. **初始方案**：`config.json` 存一套配置，改文件 + 重启切换
2. **用户追问**：`.env` 和 `config.json` 怎么合作？换中转站岂不是要动态多配置？
3. **用户提议**：`config.json` 存多种配置（profiles），`.env` 只填一个作为选择开关

### 当前方案（待确认）

**多 profile 方案：**

```json
// config.json
{
  "default_profile": "wanwu",
  "profiles": {
    "wanwu": {
      "base_url": "https://2api.aiwanwu.cc",
      "default_model": "gpt-image-2",
      "size_options": [...],
      "quality_options": ["low", "medium", "high"],
      "ratios": {...}
    },
    "other": {
      "base_url": "https://other-api.com",
      "default_model": "dall-e-3",
      "size_options": [...]
    }
  }
}
```

```bash
# .env
AIWANWU_API_KEY=sk-xxx
ACTIVE_PROFILE=wanwu
```

**core/config.py 加载逻辑：**
1. 读 `.env` 拿 `ACTIVE_PROFILE`
2. 读 `config.json` 拿 `profiles[ACTIVE_PROFILE]`
3. 没设 `ACTIVE_PROFILE` → 用 `default_profile`
4. profile 里缺字段 → fallback 内置默认值

**切换方式：** 改 `.env` 的 `ACTIVE_PROFILE=other`，重启服务。不改代码，不改 `config.json`。

### 待确认

- [ ] 用户确认这个方案
- [ ] 确认后更新 plan 文档和已改代码

## 已完成的代码改动

| 文件 | 状态 | 内容 |
|---|---|---|
| `config.json` | 已完成 | 多 profile 结构（wanwu + other），default_profile 为公共默认 |
| `core/config.py` | 已完成 | 多 profile 分层加载 + 纯函数 resolve + 白名单校验 + Key 跟随 profile |
| `core/api.py` | 已完成 | import API_PATHS + URL 拼接改用 API_PATHS |
| `server.py` | 已完成 | /api/config 新增 baseUrl/defaultModel/activeProfile 返回 |

## 未完成的工作

全部完成（见上）。后续增强方向（非阻塞）：前端可进一步把 baseUrl 展示为可点击复制；多 profile 切换热生效（当前需重启）。

## 设计原则

- `config.py` 导出的变量名不变，下游零影响（main.py, core/batch.py, core/canvas.py 等不改）
- `config.json` 缺失时用内置默认值，不报错
- JSON 格式错误时 fallback 默认值 + 打印警告
- `.env` 管密钥（不 git 跟踪），`config.json` 管公开配置（git 跟踪）
- 多 profile 方案：`.env` 的 `ACTIVE_PROFILE` 选一个 profile 加载

## 相关文件

- `D:\网店实习\Imagora\.omo\plans\dynamic-config.md` — 详细计划文档（单 profile 版本，待更新为多 profile）
- `D:\网店实习\Imagora\core\config.py` — 配置加载层
- `D:\网店实习\Imagora\core\api.py` — API 调用层
- `D:\网店实习\Imagora\server.py` — HTTP 服务层
- `D:\网店实习\Imagora\frontend\src\types.ts` — 前端类型定义

## 已知问题

- `server.py:583` LSP 报 "Argument missing for parameter id" 是**误报**（`GenerationTask.id` 有 `default_factory`），pre-existing，非本次范围，勿修

## 验证状态

| 检查 | 结果 |
|---|---|
| 后端测试 | 126 passed（原 113 + 新增 13 个多 profile 用例；沙箱需 --basetemp 规避 tmp_path 权限） |
| ruff check | 零告警 |
| 前端 tsc / lint / test / build | 全绿（73 用例） |
| 服务实测 | /api/config 返回 baseUrl/defaultModel/activeProfile；ACTIVE_PROFILE 切换后 BASE_URL/模型随 profile 变化 |

## 下一步

- 无阻塞项。可选：热生效（监听 config.json 变更自动重载，需评估复杂度）；为 `API_PATHS` 补 profile 级差异测试。
