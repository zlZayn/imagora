// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkBudget, submitGenerate } from "./api";
import { useGenerationTask } from "./useGenerationTask";

// 提交走真实 API 会因 jsdom 无 baseURL 失败，这里 mock 掉 submit 的网络层
vi.mock("./api", () => ({
  submitGenerate: vi.fn(async () => ({ taskId: "task-1", status: "queued" })),
  cancelTask: vi.fn(async () => undefined),
  fetchTask: vi.fn(async () => ({ taskId: "task-1", status: "queued" })),
  checkBudget: vi.fn(async () => ({
    allowed: false, over: true, confirmed: false, reason: "本次预估 0.15 元，超过单次上限 0.10 元",
    estimate: 0.15, spentToday: 0, remaining: 0, settings: { dailyLimit: 0, singleRunLimit: 0.1 },
  })),
}));

const PARAMS = {
  prompt: "p", refPaths: [], files: [], size: "1024x1024", quality: "high", outputDir: "out", win: 0,
};

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

/**
 * 预算闸门兜底确认：单张提交（经典表单 / 画布节点 / 全部运行）命中服务端 409 时，
 * 用 /api/budget/check 的原因问一次；确认后带 allowOverBudget 重提，
 * 同一窗口会话内只问一次（「全部运行」不连问 N 次）。
 */
describe("useGenerationTask 超预算确认（409 → 确认 → 重提）", () => {
  /** 未确认（未带 allowOverBudget）即抛 409，确认后放行 */
  function budgetGate() {
    return vi.fn(async (params: { allowOverBudget?: boolean; taskId?: string }) => {
      if (!params.allowOverBudget) {
        const error = new Error("HTTP 409: 本次预估 0.15 元，超过单次上限 0.10 元") as Error & { status?: number };
        error.status = 409;
        throw error;
      }
      return { taskId: "task-after-confirm", status: "queued" as const };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("确认超预算：带 allowOverBudget 重提并返回新 taskId", async () => {
    vi.mocked(submitGenerate).mockImplementation(budgetGate() as never);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useGenerationTask());
    let taskId = "";
    await act(async () => {
      taskId = await result.current.submit(PARAMS);
    });

    expect(taskId).toBe("task-after-confirm");
    expect(checkBudget).toHaveBeenCalledWith({ count: 1, size: "1024x1024" });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain("超过单次上限");
    expect(submitGenerate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(submitGenerate).mock.calls[1][0]).toMatchObject({ allowOverBudget: true });
  });

  it("取消确认：抛出 409 错误且不重提", async () => {
    vi.mocked(submitGenerate).mockImplementation(budgetGate() as never);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const { result } = renderHook(() => useGenerationTask());
    await act(async () => {
      await expect(result.current.submit(PARAMS)).rejects.toThrow("超过单次上限");
    });

    expect(submitGenerate).toHaveBeenCalledTimes(1);
  });

  it("同一 hook 实例内已确认过：后续 409 直接重提，不再询问", async () => {
    vi.mocked(submitGenerate).mockImplementation(budgetGate() as never);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useGenerationTask());
    await act(async () => {
      await result.current.submit(PARAMS);
    });
    await act(async () => {
      await result.current.submit({ ...PARAMS, prompt: "第二条" });
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1); // 只问一次
    expect(submitGenerate).toHaveBeenCalledTimes(4); // 两条各"409 + 重提"
  });

  it("非 409 错误直接抛出，不触发确认", async () => {
    vi.mocked(submitGenerate).mockRejectedValue(new Error("HTTP 500: 上游炸了"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useGenerationTask());
    await act(async () => {
      await expect(result.current.submit(PARAMS)).rejects.toThrow("上游炸了");
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(checkBudget).not.toHaveBeenCalled();
  });
});
