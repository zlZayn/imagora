# frontend/ — React SPA（画布工作台 UI）

React 19 + TypeScript + Vite + Tailwind v4 + React Flow（`@xyflow/react`）。

## 本地快速命令（在本目录执行）

```powershell
npm install
npm run dev        # 开发模式（热更新；需后端已启动，见下）
npm run build      # tsc --noEmit + vite build → dist/（git 忽略，由后端服务进程直接托管）
npm test           # vitest run（纯函数/组件单测，120 用例）
npm run lint       # eslint
npx tsc --noEmit   # 类型检查
```

后端（任意终端，项目根目录）：

```powershell
.\.venv\Scripts\python.exe -m main ui --no-browser --port 7860
```

E2E（画布交互回归，真实浏览器）：

```powershell
# 前置：上面 7860 服务已在跑 + playwright 已装
#   .\.venv\Scripts\python.exe -m pip install playwright
#   .\.venv\Scripts\python.exe -m playwright install chromium
.\.venv\Scripts\python.exe ..\frontend\e2e\verify_canvas.py      # 36 项断言
```

## 本目录的坑

- **契约双端同步**：`src/api.ts` 与后端 `/api` 一一对应，类型契约集中在 `src/types.ts`（ARCHITECTURE.md 7.2）；改后端接口必须同步这里。
- **UI 生效需重建**：改完代码 `npm run build`，否则浏览器拿到的是旧 `dist/`（dist 被 git 忽略，CI 上必须自己构建）。
- 纯函数集中在 `src/*.ts`（workflow / layout / canvasDrop / previewZoom / canvasHistory / recovery …），单测同名 `*.test.ts` 同目录；组件在 `src/components/`。
- 动效/样式类统一收敛 `src/index.css`（`@layer components`），组件只引用类名；动画只动 transform/opacity（GPU 合成）。
- 预览缩放/夹紧数学在 `src/previewZoom.ts` 纯函数，UI 不重算（ARCHITECTURE.md 9.5）。