# Imagora Vertical Canvas Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the canvas left-to-right flow with a compact top-to-bottom flow, including vertical handles, vertical auto-connect rules, and a three-band auto layout.

**Architecture:** Keep connection type rules unchanged and isolate geometry in `workflow.ts`. `CanvasNodes.tsx` only changes handle positions. The pure workflow functions remain covered by Vitest, while the final React Flow behavior is verified in the local browser against the current recovery snapshot.

**Tech Stack:** React 19, TypeScript, `@xyflow/react`, Vitest, Vite

---

### Task 1: Vertical Connection Handles

**Files:**
- Modify: `frontend/src/components/CanvasNodes.tsx`

- [ ] **Step 1: Change every input handle to the top and every output handle to the bottom**

For image, group, and prompt nodes, use this mapping:

```tsx
<Handle type="target" position={Position.Top} className="!h-3 !w-8 !rounded !border-0 !bg-brand/90" />
<Handle type="source" position={Position.Bottom} className="!h-3 !w-8 !rounded !border-0 !bg-brand" />
```

Keep both handles on image nodes because an image can be either a reference input or a generated result.

- [ ] **Step 2: Build to verify the React Flow handle API and TypeScript types**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite complete with exit code 0.

### Task 2: Vertical Auto-Connect Rules

**Files:**
- Modify: `frontend/src/workflow.test.ts`
- Modify: `frontend/src/workflow.ts`

- [ ] **Step 1: Write failing tests for vertical direction selection**

Add tests that create one prompt at `y=400`, one image at `y=0`, and one image at `y=900`:

```ts
expect(autoConnect([topImage, prompt, bottomImage], [])).toEqual([
  edge("top-image", "prompt"),
  edge("prompt", "bottom-image"),
]);
```

Add a second test asserting an image above a nearer group connects to the group even when no prompt exists.

- [ ] **Step 2: Run the focused test and verify the old horizontal logic fails**

Run: `cd frontend && npm test -- --run src/workflow.test.ts`

Expected: FAIL because `autoConnect` currently compares `position.x`.

- [ ] **Step 3: Replace horizontal comparisons with vertical comparisons**

Use group candidates below the image and choose direction by Y position:

```ts
const nearbyGroup = nearest(
  image,
  groups.filter((group) => group.position.y >= image.position.y),
);
if (nearbyGroup && (!prompt || distance(image, nearbyGroup) < distance(image, prompt))) {
  add(image, nearbyGroup);
} else if (prompt && image.position.y <= prompt.position.y) {
  add(image, prompt);
} else if (prompt) {
  add(prompt, image);
}
```

Retain existing deduplication, populated-group preference, and missing-reference prompt completion.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `cd frontend && npm test -- --run src/workflow.test.ts`

Expected: all workflow tests pass.

### Task 3: Three-Band Top/Middle/Bottom Auto Layout

**Files:**
- Modify: `frontend/src/workflow.test.ts`
- Modify: `frontend/src/workflow.ts`

- [ ] **Step 1: Add failing layout tests**

Cover these exact relationships:

```ts
expect(reference.position.y).toBeLessThan(group.position.y);
expect(group.position.y).toBeLessThan(prompt.position.y);
expect(prompt.position.y).toBeLessThan(result.position.y);
expect(firstPrompt.position.y).toBe(secondPrompt.position.y);
expect(firstPrompt.position.x).toBeLessThan(secondPrompt.position.x);
```

Also reuse measured node sizes to assert every pair of returned rectangles has at least `16px` separation.

- [ ] **Step 2: Run the focused test and verify the current left/middle/right layout fails**

Run: `cd frontend && npm test -- --run src/workflow.test.ts`

Expected: FAIL on vertical ordering and equal prompt Y assertions.

- [ ] **Step 3: Implement global bands**

Replace per-prompt vertical stacking with these phases:

```ts
const promptOrder = [...promptNodes].sort(
  (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
);
const promptY = inputBandBottom + LAYOUT.groupGap;
let promptX = LAYOUT.leftMargin;
for (const prompt of promptOrder) {
  positions.set(prompt.id, { x: promptX, y: promptY });
  promptX += nodeSize(prompt).width + LAYOUT.groupGap;
}
```

Place direct reference images and group member images in the top band. Place each group below its member images and center it over the horizontal span of its connected prompts. Place each result below its source prompt and center multiple results around that prompt. Put remaining orphan nodes after the connected top-band nodes. Use `nodeSize()` for every width and height calculation.

- [ ] **Step 4: Run focused tests and refine spacing until all pass**

Run: `cd frontend && npm test -- --run src/workflow.test.ts`

Expected: all workflow tests pass with no overlaps.

### Task 4: Full Verification and Current-Canvas QA

**Files:**
- Verify: `frontend/src/components/CanvasNodes.tsx`
- Verify: `frontend/src/workflow.ts`
- Verify: `frontend/src/workflow.test.ts`

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd frontend && npm test -- --run`

Expected: all test files pass.

- [ ] **Step 2: Run the production build**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 3: Verify the current recovery canvas in the browser**

Reload `http://127.0.0.1:7861/`, restore the current snapshot, and click `自动整理`. Confirm:

```text
reference/image Y < group Y < prompt Y < generated result Y
all prompt cards share one Y coordinate
all target handles are on top
all source handles are on bottom
no pair of visible node rectangles overlaps
```

- [ ] **Step 4: Verify auto-connect on a fresh prompt**

Add one prompt card, click `自动连线`, and confirm it receives one incoming edge from a populated image group. Undo the test actions so the recovery snapshot returns to its original state.
