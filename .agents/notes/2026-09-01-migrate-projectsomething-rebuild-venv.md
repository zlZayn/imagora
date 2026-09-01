# 决策：迁移至 ProjectSomething 并重建 .venv（2026-09-01）

已实施：shipped

## 问题

项目从 `D:\网店实习\Imagora` 整体移动到 `D:\ProjectSomething\Imagora`，目录名保持 Imagora 不变。

移动后 `.venv` 内绝对路径失效：`pyvenv.cfg` 的 `home` 指向 `C:\Windows`（0xC0000135 DLL 缺失隐患），`prompt` 残留旧名 `a-image-tools`。

## 决策

- 仓库原样迁移，远程 `github.com:zlZayn/imagora.git` 不变；本地提交，不推送
- `.venv` 删除后 `uv sync` 重建（uv.lock 锁定 34 包，tuna 镜像）；`pyvenv.cfg` `prompt=imagora`，`python.exe` 与 `uv run python` 直跑均正常
- 硬编码清零：`frontend/src/components/CopyChip.tsx` 注释移除示例绝对路径；根 `AGENTS.md` 移除 0xC0000135 工作区坑位（重建后不再成立）
- 测试命令随迁简化：工作目录为纯 ASCII 路径，`--basetemp` 限定不再必需

## 替代方案（强制）

- 保留旧 `.venv` 仅手改 `pyvenv.cfg`：治标不治本，site-packages 残留旧布局与 DLL 隐患
- 绕过 `uv` 直接用系统 Python：非项目正统工作流，`uv run` 仍会按 `uv.lock` 重建，双轨矛盾

## 影响

- 新位置纯 ASCII 路径，消除中文目录触发的 `tmp_path` 挂死坑（原 tests/README 特有坑）
- 未动任何用户数据：`output/`、`logs/`、`screenshots/` 内容原样保留；`.env` 未读取密钥内容