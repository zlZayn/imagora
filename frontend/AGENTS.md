# AGENTS.md — frontend/

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

frontend/ 特有约束：
- 契约双端同步：改后端接口必须同步 [src/types.ts](src/types.ts) + [src/api.ts](src/api.ts)，漏一处即断链
- 动效/样式类收敛 [src/index.css](src/index.css)（`@layer components`）；组件只引用类名，动画只动 transform/opacity
- 纯函数模块（src 根 *.ts）必须配同名 `*.test.ts` 单测；新纯逻辑进纯函数模块，不进组件
- 文件索引（纯函数 / hooks / 组件 / 变更路由）→ [README.md](README.md)，不在此重复
- 设计背景（动效约束/按钮体系/预览统一）→ [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
