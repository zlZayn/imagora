# core/ — 无 HTTP 纯逻辑层

FastAPI 路由（`server.py`）与 CLI（`main.py`）共用的业务纯逻辑，**不依赖 HTTP / FastAPI / 前端**。改这里后跑 pytest 验证（不用起服务）。

## 模块速览（细节见 [../ARCHITECTURE.md](../ARCHITECTURE.md) 2.x / 5.x）

| 模块 | 职责 |
| --- | --- |
| `api.py` | 上游生图 API 封装（全项目唯一外部网络调用点） |
| `registry.py` | 资产注册表（`.assets`，内容 sha1 去重） |
| `canvas.py` | 画布路径/注册表 shim、图片节点解析 |
| `graphstore.py` | 工作流/提交快照/恢复快照存储 + 资产旁路公共函数 |
| `history.py` | 生成历史 JSONL 读取 + 账本迁移 |
| `logging.py` | `generation.jsonl` 账本写入 |
| `tasks.py` | 生成任务状态机（队列/取消/快照/TTL） |
| `config.py` | 配置中心（profile / size / quality / API Key） |
| `batch.py` | CLI 批量编排 |
| `console.py` | 交互菜单 / 彩色输出 |
| `imageinfo.py` | 图片头解析（宽高/格式） |
| `pathtrust.py` | 路径白名单校验（安全） |

## 本地快速命令（在项目根目录执行）

```powershell
.\.venv\Scripts\python.exe -m pytest --basetemp=C:/t/imagora-pytest        # 全量（含 core 测试）
.\.venv\Scripts\python.exe -m pytest tests/test_core_api.py --basetemp=C:/t/imagora-pytest
.\.venv\Scripts\python.exe -m ruff check core
```

## 本目录的坑

- **pytest 必须 `--basetemp=C:/t/imagora-pytest`**：项目路径含中文「网店实习」，默认 tmp 路径会挂。
- **测试绝不真调上游生图 API**（花钱）：全部 monkeypatch 隔离；改 `api.py` 时保持接口可注入。
- 约束：core 不 import `server` / fastapi，否则纯逻辑层被 HTTP 污染（分层原则见 ARCHITECTURE.md 2.1）。