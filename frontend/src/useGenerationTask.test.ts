// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGenerationTask } from "./useGenerationTask";

// 提交走真实 API 会因 jsdom 无 baseURL 失败，这里 mock 掉 submit 的网络层
vi.mock("./api", () => ({
  submitGenerate: vi.fn(async () => ({ taskId: "task-1", status: "queued" })),
  cancelTask: vi.fn(async () => undefined),
  fetchTask: vi.fn(async () => ({ taskId: "task-1", status: "queued" })),
}));

/**
 * 回归测试：useGenerationTask 的稳定成员（submit/cancel/get/subscribe）
 * 在多次渲染间必须保持同一引用。
 *
 * 背景：CanvasPage 的 nodeTypes 依赖链包含 handleRun / handleDeleteNode，
 * 它们依赖 generationTask 的这些成员。若成员每次渲染重建，useCallback
 * 每次重建 → nodeTypes 每次重建 → React Flow 把节点组件当新类型 →
 * 全节点重挂载 → 入场动画反复重播（闪烁）。
 */
describe("useGenerationTask 稳定成员引用（防画布闪烁回归）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submit/cancel/get/subscribe 多次渲染引用稳定（tasks 无变化）", () => {
    const { result, rerender } = renderHook(() => useGenerationTask());

    const first = result.current;
    act(() => rerender());

    expect(result.current.submit).toBe(first.submit);
    expect(result.current.cancel).toBe(first.cancel);
    expect(result.current.get).toBe(first.get);
    expect(result.current.subscribe).toBe(first.subscribe);
  });

  it("任务状态刷新后（emit）稳定成员仍不重建", async () => {
    const { result, rerender } = renderHook(() => useGenerationTask());

    const before = result.current;
    // submit 触发 emit → setVersion → 重渲染
    await act(async () => {
      await result.current.submit({
        prompt: "p",
        refPaths: [],
        files: [],
        size: "1024x1024",
        quality: "high",
        outputDir: "out",
        win: 0,
      });
    });
    act(() => rerender());

    expect(result.current.tasks).not.toBe(before.tasks); // tasks 数组必然新建（对照）
    expect(result.current.submit).toBe(before.submit);
    expect(result.current.cancel).toBe(before.cancel);
    expect(result.current.get).toBe(before.get);
    expect(result.current.subscribe).toBe(before.subscribe);
  });
});
