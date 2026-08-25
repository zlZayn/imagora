// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZoomModal } from "./WorkflowModals";

/**
 * 回归测试：ZoomModal 用 createPortal 挂到 body，合成事件沿 React 组件树冒泡（非 DOM 树）。
 * 若不在 Portal 根截停 click，外层宿主（如 HistoryGallery 遮罩 onClick=onClose）会被放大图内的
 * 点击误关 —— 表现为「点放大图中间却退出到画布」。关闭判定本身走 pointerdown，此处只验证截停冒泡。
 */
describe("ZoomModal（Portal 点击隔离）", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("点图片本体：不关闭放大预览，也不冒泡触发外层宿主关闭", () => {
    const onClose = vi.fn();
    const onHostClose = vi.fn();
    render(
      <div onClick={onHostClose}>
        <ZoomModal imageUrl="https://example.com/a.png" name="测试图" onClose={onClose} />
      </div>,
    );
    const img = screen.getByAltText("预览");
    fireEvent.pointerDown(img);
    fireEvent.click(img);
    expect(onClose).not.toHaveBeenCalled();
    expect(onHostClose).not.toHaveBeenCalled();
  });

  it("点空白处：只关闭放大预览，不冒泡触发外层宿主关闭", () => {
    const onClose = vi.fn();
    const onHostClose = vi.fn();
    render(
      <div onClick={onHostClose}>
        <ZoomModal imageUrl="https://example.com/a.png" name="测试图" onClose={onClose} />
      </div>,
    );
    const overlay = document.querySelector("[data-zoom-overlay]") as HTMLElement;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onHostClose).not.toHaveBeenCalled();
  });
});
