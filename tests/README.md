# tests/ — 后端单测（pytest）

FastAPI 路由级 + 纯逻辑测试，**不调真实上游 API、不花钱**。顶层 `conftest.py` 提供共享 fixture。

## 本地快速命令（在项目根目录执行）

```powershell
.\.venv\Scripts\python.exe -m pytest --basetemp=C:/t/imagora-pytest           # 全量（205 通过）
.\.venv\Scripts\python.exe -m pytest tests/test_core_history.py --basetemp=C:/t/imagora-pytest
```

## 本目录的坑

- **必须 `--basetemp=C:/t/imagora-pytest`**：项目路径含中文「网店实习」，不指定会触发 tmp_path 挂死。
- **5 个 Windows 专属测试**（netstat 端口探测 / powershell 父进程链 / C: 绝对路径 / 跨盘相对化）：只保证在 Windows 通过，CI 的 pytest Job 必须跑 `windows-latest`。
- 路由测试直接 `from server import ...`（import 即建 FastAPI app，属预期）。
- 改 `server.py` / `core/` 后跑全量；改接口契约同步改 `tests/test_server_*` 与前端 `src/types.ts`。