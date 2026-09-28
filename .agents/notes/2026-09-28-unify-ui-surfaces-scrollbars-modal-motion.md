# 决策：统一容器表面、滚动条与模态高度过渡（2026-09-28）

状态：生效

## 问题

同属一套 UI，观感分叉成两套：

- 滚动条：历史列表跟随容器底色，其余地方是浏览器默认白槽。
- 容器表面：同排容器有的走渐变、有的是纯色；渐变还用了两种角度（145deg / 160deg）。
- 模态页签切换：内容横向位移，并闪出滚动条；高度直接跳变无过渡。

## 决策

- 滚动条全局统管（`--sb-size` / `--sb-thumb` / `--sb-track`）：轨道恒 `transparent`，即所在容器底色；滑块中性半透明 + 内缩。局部只允许覆盖成「隐藏」（如 `.studio-inspector`）。
- 容器表面分档（`--surface-card` / `--surface-panel`）：同级容器同一套 150deg 微渐变，层次靠档位而非有无。
- 模态内容区 `.modal-body`：高度由 JS 量出的 `--panel-h` 驱动 transition；`scrollbar-gutter: stable` 防横向位移；变高窗口加 `[data-growing]` 临时裁切，抑制滚动条闪出。
- 模态页签 `.tabs` 与顶栏 `.mode-switch` 共用同源视觉（尺寸走 `--h-ctl`）。

## 替代方案（强制）

- 纯 CSS 高度过渡（`interpolate-size: allow-keywords` + `transition: height`）：对「内容变化导致 `auto` → `auto`」不插值，实测无过渡；跨浏览器支持也不齐。
- 给内容区固定 `min-height`：页签内容量差异大，小页留白、大页仍要滚，等于把问题换成空白。
- 每处容器各写自己的 `scrollbar-color`：重复且会继续漂移，正是「历史列表和别人不一样」的成因。

## 影响

- 新增公共类必须登记到 [frontend/README.md](../../frontend/README.md)「样式体系」节，否则观感会再次分叉。
- 模态高度过渡依赖 `ResizeObserver` + `--panel-h`；组件若自行设 `height` 会使其失效（规则见 [frontend/AGENTS.md](../../frontend/AGENTS.md)）。
