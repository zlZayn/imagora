# frontend/src/ — 前端源码根

- 职责：前端源码根——纯函数模块、hooks、入口 `main.tsx` / `App.tsx`、全局样式 `index.css`。
- 本目录**不抄文件清单**（清单会随每次新增漂移，此前就漂过一轮）。要知道有什么，按命名约定现查：
  `xxx.ts` 纯函数（配同名 `xxx.test.ts`）· `useXxx.ts(x)` hook · `components/` 组件。
  现查命令：`Get-ChildItem frontend/src -File -Name`
- 逐模块职责 / 导出 / 被谁依赖 / 改后必测 → [frontend/README.md](../README.md)「文件索引」（纯函数模块 / Hooks / 组件三节，这里是权威）
- 测试文件 ↔ 用例数 → [tests/README.md](../../tests/README.md) 的前端表（总数由 `python scripts/check_docs.py` 校验）
- 新公共类 / token 登记处 → [frontend/README.md](../README.md)「样式体系」节
- 变更影响路由：改这里 → 回查根 [AGENTS.md](../../AGENTS.md) 的验证快照与变更速查
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
