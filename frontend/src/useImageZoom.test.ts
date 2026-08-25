// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLICK_OPEN_DELAY_MS, useImageZoom, type ZoomTarget } from "./useImageZoom";

const ITEM: ZoomTarget = { url: "https://example.com/a.png", name: "测试图" };

/** 单击事件桩：真实 React 事件（MouseEvent）同样满足 preventDefault 结构 */
const clickEvent = () => ({ preventDefault: vi.fn() });

/**
 * 回归测试：Gallery 与 HistoryGallery 共用的「单击开原图 / 双击放大」时序。
 * 锁定：双击第二击必须取消未决的单击开窗（否则双击连开两个新标签）；
 *       卸载时必须清掉未决延时（否则幽灵开窗）。
 */
describe("useImageZoom（单击开原图 / 双击放大，250ms 区分）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("单击：延时 250ms 后开原图新标签（期间不立即打开）", () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useImageZoom());

    act(() => result.current.handleClick(clickEvent(), ITEM));
    expect(open).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(CLICK_OPEN_DELAY_MS));
    expect(open).toHaveBeenCalledWith(ITEM.url, "_blank", "noopener");
  });

  it("双击：第二击取消未决开原图，改为放大预览（不连开两个标签）", () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useImageZoom());

    act(() => result.current.handleClick(clickEvent(), ITEM)); // 第一击
    act(() => result.current.handleClick(clickEvent(), ITEM)); // 第二击：取消未决的开原图
    act(() => result.current.handleDoubleClick(ITEM)); // dblclick 事件到达

    act(() => vi.runAllTimers());
    expect(open).not.toHaveBeenCalled();
    expect(result.current.zoom).toEqual(ITEM);
  });

  it("closeZoom 关闭预览", () => {
    const { result } = renderHook(() => useImageZoom());

    act(() => result.current.handleDoubleClick(ITEM));
    expect(result.current.zoom).toEqual(ITEM);

    act(() => result.current.closeZoom());
    expect(result.current.zoom).toBeNull();
  });

  it("卸载时清理未决延时，不产生幽灵开窗", () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result, unmount } = renderHook(() => useImageZoom());

    act(() => result.current.handleClick(clickEvent(), ITEM));
    unmount();
    act(() => vi.runAllTimers());

    expect(open).not.toHaveBeenCalled();
  });
});