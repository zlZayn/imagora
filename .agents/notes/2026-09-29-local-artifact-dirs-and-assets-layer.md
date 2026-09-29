# 决策：本机产物目录用 `_` 前缀（`_ui-audit/`）+ `assets/` 层级保留（2026-09-29）

状态：生效

## 问题

两件事凑到一起：

- 仓里有两个 `screenshots`：`assets/screenshots/` 是入库的门面配图，根 `screenshots/` 是开发期 UI 审计图（不入库）。同名不同命——`.gitignore` 必须靠 `/screenshots/` 的斜杠与三行注释才不至于连 assets 那份一起吞掉；访客在根目录第一眼看到 `screenshots/`，也容易当成文档配图。
- `assets/` 下只有 `screenshots/` 一类，看着像"多余的层级"，容易被后来者顺手砍掉。

## 决策

1. 根 `screenshots/` 改名 `_ui-audit/`：下划线前缀 = 本机产物、不入库、可随时重建（沿用既有的 `_shots-*` 命名习惯）。同时把 `capture.py` 从被忽略的目录搬进 `scripts/` 入库，并加 `--out`（默认 `_ui-audit/`，相对路径按项目根解析）——"重拍哪 12 个状态"的配方不能只活在维护者本机。
2. `assets/` 层级保留：它是"入库的文档资产的家"，按用途分子目录（`screenshots/`、将来的 `diagrams/`）。"目前只有一类也保留这层"写进 [assets/README.md](../../assets/README.md)，不让下一个人再问一遍。

## 替代方案（强制）

- **目录名用 `_shots/`**：短，但本仓里"shot"已经指生成结果图（`output/`、生成历史），容易误读成生成产物；`_ui-audit` 把"UI 审计"与"本机"两层意思都带上了。
- **`capture.py` 留在 `_ui-audit/` 跟产物作伴**：脚本与产物确实绑定，但整个目录被忽略，等于配方随机器走丢（换机、重装就没了）；搬进 `scripts/` 后用 `--out` 默认值保住"照旧一条命令、图还出在原处"的手感。
- **砍掉 `assets/`，让 `screenshots/` 升到仓库根**：立刻又和 `_ui-audit/` 撞概念（两个都叫"截图"，一个入库一个不入库），还丢掉"assets = 只服务 markdown 渲染"这个唯一含义；省下的只是两个 md。
- **保留 `assets/` 但把 3 张图平铺（去掉 `screenshots/` 层）**：`diagrams` 一类出现时仍要重排，README 链接与语义都得动，省不下什么。

## 影响

- `.gitignore` 里那段"防吞"注释（3 行）删除，只剩 1 行说明；两个截图目录不再互相牵连。
- 审计图命令变了：`python screenshots\capture.py` → `python scripts\capture.py`（换目录用 `--out`）。
- 门面配图 `assets/screenshots/` 与根 README 的三处链接**均未动**。
- 本目录（notes）里 2026-09-01 迁移记录中提到的 `screenshots/` 是当时的历史事实，不改。
