# Imagora Image Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add double-click image preview, a right-side image action rail, correctly aligned zoom-stable handles, and theme-colored temporary connections.

**Architecture:** Keep the existing `ZoomModal` callback flow. Test image-node behavior through React rendering, and keep handle geometry fixed in canvas coordinates so React Flow does not retain stale measurements after zooming.

**Tech Stack:** React 19, TypeScript, React Flow 12, Tailwind CSS 4, Vitest, Testing Library, lucide-react.

---

### Task 1: Image Preview And Right-Side Actions

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/components/CanvasNodes.tsx`
- Create: `frontend/src/components/CanvasNodes.test.tsx`

- [ ] **Step 1: Add focused UI dependencies**

Run `npm install lucide-react` and `npm install --save-dev @testing-library/react jsdom`.

Expected: package files contain all three packages.

- [ ] **Step 2: Write the failing image-node tests**

Create a jsdom Vitest test that renders `ImageNode` inside `ReactFlowProvider`. Double-click `screen.getByAltText("sample.png")` and assert `onZoom` receives `"image-1"`. Assert a `data-testid="image-action-rail"` element contains accessible buttons named `预览大图`, `替换图片`, and `删除图片`, and its class contains `left-full`.

```tsx
// @vitest-environment jsdom
import { type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageNode } from "./CanvasNodes";

afterEach(cleanup);

function renderImageNode(onZoom = vi.fn()) {
  const props = {
    id: "image-1",
    type: "image",
    data: {
      registryId: "registry-1",
      name: "sample.png",
      url: "/sample.png",
      size: 1,
      ext: "png",
      refCount: 0,
      absPath: "C:\\sample.png",
    },
    selected: false,
    onZoom,
    onReplace: vi.fn(),
    onDelete: vi.fn(),
  } as unknown as ComponentProps<typeof ImageNode>;
  render(<ReactFlowProvider><ImageNode {...props} /></ReactFlowProvider>);
  return onZoom;
}

describe("ImageNode", () => {
  it("opens preview when the image is double-clicked", () => {
    const onZoom = renderImageNode();
    fireEvent.doubleClick(screen.getByAltText("sample.png"));
    expect(onZoom).toHaveBeenCalledWith("image-1");
  });

  it("places accessible image actions in the right-side rail", () => {
    renderImageNode();
    expect(screen.getByTestId("image-action-rail").className).toContain("left-full");
    expect(screen.getByRole("button", { name: "预览大图" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "替换图片" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除图片" })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

Run: `npm test -- --run src/components/CanvasNodes.test.tsx`

Expected: FAIL because the double-click handler and right-side action rail do not exist.

- [ ] **Step 4: Implement the minimal image interaction**

Import `Eye`, `RefreshCw`, and `Trash2` from `lucide-react`. Extend `ActionButton` with `aria-label` and `title`. Render the image actions in an absolute `left-full top-2 ml-1` vertical rail and call `onZoom(id)` from the image's `onDoubleClick`. Keep all buttons `nodrag`.

```tsx
<div
  data-testid="image-action-rail"
  className="absolute left-full top-2 z-30 ml-1 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100"
>
  <ActionButton label="预览大图" onClick={() => onZoom(id)}><Eye size={14} /></ActionButton>
  <ActionButton label="替换图片" onClick={() => onReplace(id)}><RefreshCw size={14} /></ActionButton>
  <ActionButton label="删除图片" onClick={() => onDelete(id)} danger><Trash2 size={14} /></ActionButton>
</div>

<div className="h-40 w-32 overflow-hidden rounded bg-neutral-50" onDoubleClick={() => onZoom(id)}>
  <img src={data.url} alt={data.name} className="block h-full w-full object-contain" draggable={false} />
</div>
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm test -- --run src/components/CanvasNodes.test.tsx`

Expected: 2 tests pass.

### Task 2: Handle Alignment And Theme Color

**Files:**
- Modify: `frontend/src/index.css`
- Create: `frontend/src/canvasStyles.test.ts`

- [ ] **Step 1: Write the failing CSS regression tests**

Read `index.css` with `readFileSync(new URL("./index.css", import.meta.url), "utf8")`. Assert it contains fixed `width: 32px` and `height: 12px`, the top/bottom handle rules do not contain `scale(`, and `.react-flow__connection-path` uses `stroke: var(--color-brand)` rather than `#ef4444`.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

describe("canvas connection styles", () => {
  it("keeps stable handle geometry across zoom levels", () => {
    expect(css).toContain("width: 32px");
    expect(css).toContain("height: 12px");
    expect(css).not.toMatch(/react-flow__handle-(?:top|bottom)[\\s\\S]{0,160}scale\\(/);
  });

  it("uses the active window brand for the temporary connection", () => {
    expect(css).toMatch(/react-flow__connection-path[\\s\\S]*stroke: var\(--color-brand\)/);
    expect(css).not.toMatch(/react-flow__connection-path[\\s\\S]*#ef4444/);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- --run src/canvasStyles.test.ts`

Expected: FAIL on handle sizing and fixed red connection color.

- [ ] **Step 3: Implement the CSS fix**

Set fixed handle width and height. Restore top/bottom `translate(-50%, 50%)` and `translate(-50%, -50%)` without inverse scale, remove the duplicated stale handle comment, and replace `#ef4444` with `var(--color-brand)`.

```css
.react-flow__handle {
  width: 32px !important;
  height: 12px !important;
}
.react-flow__handle-bottom {
  transform: translate(-50%, 50%) !important;
}
.react-flow__handle-top {
  transform: translate(-50%, -50%) !important;
}
.react-flow__connection .react-flow__connection-path {
  stroke: var(--color-brand) !important;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- --run src/canvasStyles.test.ts`

Expected: 2 tests pass.

### Task 3: Full Verification

**Files:**
- Verify only; no planned production edits.

- [ ] **Step 1: Run all frontend tests**

Run: `npm test -- --run --reporter=dot`

Expected: all test files pass.

- [ ] **Step 2: Build production assets**

Run: `npm run build`

Expected: TypeScript and Vite build exit successfully.

- [ ] **Step 3: Verify the running page**

Verify that double-click opens the correct preview, all three controls sit to the image's right, and edge endpoints meet handle outer edges within one screen pixel at fitted zoom, 100%, and 200%. Verify the temporary path stroke equals the current window brand color, then close the preview and remove any test-only canvas changes.

- [ ] **Step 4: Check edited files**

Run `git diff --check` against the six edited package, component, style, and test files.

Expected: no whitespace errors.
