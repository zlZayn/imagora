# frontend/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

frontend/ 特有约束：
- 契约双端同步：改后端接口必须同步 [src/types.ts](src/types.ts) + [src/api.ts](src/api.ts)，漏一处即断链
- 严格开关已全开（[tsconfig.json](tsconfig.json)：`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）：数组/记录下标访问先收窄再直接用；可选属性不要显式赋 `undefined`（`{ k: undefined }` 与「不提供该键」在 eOPT 下不是一回事）。判据是 `npx tsc --noEmit -p tsconfig.json` 零错，不是「CLI 加开关跑过」——两开关单独开都可能为 0 错、同时开才暴露交互位点
- 动效/样式类收敛 [src/index.css](src/index.css)（`@layer components`）；组件只引用类名，动画只动 transform/opacity
- 纯函数模块（src 根 *.ts）必须配同名 `*.test.ts` 单测；新纯逻辑进纯函数模块，不进组件
- 行尾按文件不同（`types.ts` / `workflow.test.ts` / `components/CanvasPage.tsx` 为 CRLF，其余多为 LF）：批量脚本改写必须逐文件保留原行尾，否则整文件翻行尾、diff 爆炸
- 文件索引（纯函数 / hooks / 组件 / 变更路由）→ [README.md](README.md)，不在此重复
- 设计背景（动效约束/按钮体系/预览统一）→ [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
