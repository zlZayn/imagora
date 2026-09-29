# 决策：品牌图形收成一份源（2026-09-29）

状态：生效

## 问题

同一枚 logo 的形状在仓里存了**三份手抄**：`frontend/public/favicon.svg`、`App.tsx` 的 `BRAND_LOGO_PATH`（顶栏）、`App.tsx` 动态 favicon 模板串里的 `<path d>`；再由第一份生成 `scripts/启动生图工作台.ico` 内嵌进 exe。
换一次图形要做 5 个动作（改三处 + 重生成 ico + 重编译 exe），**漏任何一环都不报错**，只会静默出现"顶栏新图、标签页还是旧图"。
而且 `tests/` 里没有任何用例覆盖过这件事，注释里那句「品牌图形与 favicon 同源」只是口头约定。

## 决策

形状只存一份：`frontend/src/brand/logo.svg`（从原 `public/favicon.svg` 原样搬来，字节不变）。

- `frontend/src/brand/logo.ts` 用 Vite 的 `?raw` 在**构建期**把它内联成字符串，导出 `BRAND_LOGO_PATH` / `BRAND_LOGO_VIEWBOX` / `brandLogoSvg(fill)`；顶栏与动态 favicon 都从这里取，**颜色仍按窗口主题色注入，行为不变**
- `frontend/index.html` 不再放静态 `<link rel="icon">`：它本来在 React 挂载后立刻被动态图标覆盖，留着只多了第四份副本；代价是首帧极短时间标签页无图标
- `scripts/make_icon.py` 改读同一份 svg，并写下 `scripts/icon-source.sha256`（源图内容指纹）
- `check_docs.py` 比对指纹：源图改了而产物没重生成 → 红。已接进 CI 前端 job，所以这道检查真会拦
- 门面首屏图片改指 `src/brand/logo.svg`（GitHub 直接渲染该文件）

## 替代方案（强制）

- **只加校验、不合并源**：成本最低，但 5 个动作、3 份手抄的局面不变，改 logo 仍要靠人记得；合并后只剩 1 处要改，校验只是兜底。
- **运行时 `fetch('/favicon.svg')` 再注入**：会多一次网络请求，而且 favicon 时机敏感（首帧就要用）；`?raw` 是构建期内联，零请求。另外 Vite 的 `public/` 不参与打包，从那里 import 属于反模式。
- **把源图放仓库根 `assets/`**：`assets/` 现在明确只放文档配图（同一轮整理的结果），而且前端资源搬出 `frontend/` 后打包器读不到，Vite 只处理该目录内的文件。
- **反向：以 TS 常量为源，生成 svg**：python 侧要读 TS 常量跨语言，`make_icon.py` 得依赖 node 或正则扒字符串，比现在更脆。
- **用 mtime 判断产物是否过期**：git 不保留修改时间，clone 后所有文件时间戳一样，判不出来（维护者明确否掉）。改用内容指纹。
- **在 CI 里重跑 `make_icon.py` 比对字节**：需要 playwright + chromium，而前端 job 没有 Python 依赖，为一个图标检查装整套渲染链不值；只比源图指纹即可证明"源改了、产物没跟上"。

## 影响

- 收益：改形状只剩一处；"顶栏新图 / 标签页旧图"这类分裂在结构上不可能再发生；CI 会拦住"改了源忘了产物"。
- 代价：exe 图标那一环仍在本机（`make_icon.py` → 关启动器 → `make_launcher.ps1`），CI 不测双击——这条链写进根 AGENTS「构建时机」。
- `index.html` 少一个静态图标：本地起服务时首帧可能短暂无图标；若在意，恢复静态 link 就要同时接受"多一份副本"，并让 `check_docs.py` 去比对它与源图是否一致。
- 记录层那条 2026-09-28 的快捷方式决策里写的 `favicon.svg` 路径**不改**（记录层不追改），本条记录说明它已被取代。
