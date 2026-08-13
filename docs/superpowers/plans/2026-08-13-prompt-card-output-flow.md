# Prompt Card Output Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated images flow below prompt cards, add selection-scoped prompt output directory updates, keep long paths compact, and move failure text into the task center.

**Architecture:** Keep layout and bulk node mutations as pure functions in `workflow.ts`; let `CanvasPage` coordinate folder selection, history, and task events. Keep `PromptNode` presentation bounded and render task errors from the existing task snapshot in `TaskCenter`.

**Tech Stack:** React 19, TypeScript, React Flow, Vitest, Testing Library, Tailwind CSS.

---

### Task 1: Pure workflow rules

**Files:**
- Modify: `frontend/src/workflow.ts`
- Test: `frontend/src/workflow.test.ts`

- [ ] Add failing tests proving selected mixed node types only update selected prompt output directories.
- [ ] Run `npm test -- workflow.test.ts` and confirm the new tests fail because the helper is absent.
- [ ] Add `updateSelectedPromptOutputDirs(nodes, selectedIds, outputDir)` returning unchanged references when no prompt changes.
- [ ] Add failing tests proving result nodes are placed below their source prompt, centered as a row, include existing results, and do not move unrelated nodes.
- [ ] Run the focused tests and confirm failure because result placement is absent.
- [ ] Add `layoutPromptResults(nodes, edges, promptId)` using the shared `nodeSize` and layout spacing values.
- [ ] Run focused tests until green.

### Task 2: Presentation behavior

**Files:**
- Modify: `frontend/src/components/CanvasNodes.tsx`
- Modify: `frontend/src/components/FolderPicker.tsx`
- Modify: `frontend/src/components/TaskCenter.tsx`
- Test: `frontend/src/components/CanvasNodes.test.tsx`
- Create: `frontend/src/components/TaskCenter.test.tsx`

- [ ] Add failing component tests proving prompt cards omit `data.message`, the path input is right-aligned with a full-path title, and failed task details appear in TaskCenter.
- [ ] Run the focused component tests and confirm expected failures.
- [ ] Add an optional compact/right-aligned mode to `FolderPicker`, enforce prompt card width/overflow bounds, and remove inline error text.
- [ ] Render failed task errors in a wrapping, width-bounded task detail row.
- [ ] Run focused component tests until green.

### Task 3: Canvas integration

**Files:**
- Modify: `frontend/src/components/CanvasPage.tsx`
- Test: `frontend/src/workflow.test.ts`

- [ ] Replace fixed right-side result coordinates with the pure result layout helper after nodes and output edges are added.
- [ ] Add selected prompt count state derived from `onSelectionChange`.
- [ ] Add one compact multi-selection action group containing batch path and delete actions.
- [ ] Reuse `selectFolder`, ignore cancellation, record one history snapshot, apply the pure bulk helper, and log the affected prompt count.
- [ ] Ensure folder picker failures are logged without changing nodes or history.
- [ ] Run workflow and component tests.

### Task 4: Documentation and regression verification

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

- [ ] Update user-facing canvas behavior in `README.md`.
- [ ] Update ownership, data flow, layout, selection, and failure presentation details in `ARCHITECTURE.md`.
- [ ] Run `npm test`, `npm run lint`, and `npm run build` in `frontend`.
- [ ] Run the repository Python test suite with `uv run pytest`.
- [ ] Inspect `git diff --check`, the final diff, and working tree to confirm only intended files changed.
