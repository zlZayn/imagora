// @vitest-environment jsdom

import { type ComponentProps, type ElementType } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupNode, ImageNode, PromptNode } from "./CanvasNodes";

afterEach(cleanup);

/** 测试 mock 只给关心的字段，其余由类型逐字段把关；「不完整 props」的唯一断言点集中在此 */
function nodeProps<T extends ElementType>(props: Partial<ComponentProps<T>>): ComponentProps<T> {
  return props as ComponentProps<T>;
}

function renderImageNode(onZoom = vi.fn(), onCanvasDoubleClick = vi.fn(), lod?: boolean) {
  const props = nodeProps<typeof ImageNode>({
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
    lod,
    onZoom,
    onReplace: vi.fn(),
    onDelete: vi.fn(),
  });

  render(
    <div onDoubleClick={onCanvasDoubleClick}>
      <ReactFlowProvider>
        <ImageNode {...props} />
      </ReactFlowProvider>
    </div>,
  );
  return { onZoom, onCanvasDoubleClick };
}

describe("ImageNode", () => {
  it("opens preview when the image is double-clicked", () => {
    const { onZoom } = renderImageNode();

    fireEvent.doubleClick(screen.getByAltText("sample.png"));

    expect(onZoom).toHaveBeenCalledWith("image-1");
  });

  it("does not bubble image double-clicks to the canvas", () => {
    const { onCanvasDoubleClick } = renderImageNode();

    fireEvent.doubleClick(screen.getByAltText("sample.png"));

    expect(onCanvasDoubleClick).not.toHaveBeenCalled();
  });

  it("places accessible image actions in the right-side rail", () => {
    renderImageNode();

    expect(screen.getByTestId("image-action-rail").className).toContain("left-full");
    expect(screen.getByRole("button", { name: "预览大图" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "替换图片" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除图片" })).toBeTruthy();
  });

  it("leaves handle dimensions to the zoom-aware canvas styles", () => {
    renderImageNode();

    for (const handle of document.querySelectorAll(".react-flow__handle")) {
      expect(handle.className).not.toContain("!h-3");
      expect(handle.className).not.toContain("!w-8");
    }
  });
});

describe("node-pop animation wrapper", () => {
  it("adds the node-pop class to the image node card for inner animation", () => {
    renderImageNode();
    expect(document.querySelector(".node-pop")).toBeTruthy();
  });
});

describe("PromptNode", () => {
  it("keeps failure text out of the card and shows the end of long output paths", () => {
    const outputDir = "C:\\very\\long\\campaign\\product\\outputs\\final";
    const failureMessage = "A very long provider failure that must not resize the card";
    const props = nodeProps<typeof PromptNode>({
      id: "prompt-1",
      type: "prompt",
      data: {
        prompt: "product photo",
        size: "1024x1024",
        quality: "high",
        outputDir,
        status: "failed",
        message: failureMessage,
      },
      selected: false,
      onUpdate: vi.fn(),
      onRun: vi.fn(),
      onDelete: vi.fn(),
      sizeOptions: [{ value: "1024x1024", label: "1:1" }],
      qualityOptions: [{ value: "high", label: "high" }],
    });

    render(<ReactFlowProvider><PromptNode {...props} /></ReactFlowProvider>);

    expect(screen.queryByText(failureMessage)).toBeNull();
    const pathInput = screen.getByDisplayValue(outputDir);
    expect(pathInput.className).toContain("text-right");
    expect(pathInput.getAttribute("title")).toBe(outputDir);
    expect(document.querySelector(".react-flow__node-prompt")).toBeNull();
  });
});

describe("LOD abstract mode", () => {
  it("keeps the image thumbnail and double-click zoom but drops the action rail", () => {
    const { onZoom } = renderImageNode(vi.fn(), vi.fn(), true);

    expect(screen.getByAltText("sample.png")).toBeTruthy();
    fireEvent.doubleClick(screen.getByAltText("sample.png"));
    expect(onZoom).toHaveBeenCalledWith("image-1");
    expect(screen.queryByTestId("image-action-rail")).toBeNull();
    expect(screen.queryByRole("button", { name: "替换图片" })).toBeNull();
  });

  it("renders prompt cards as abstract read-only cards with status text", () => {
    const props = nodeProps<typeof PromptNode>({
      id: "prompt-1",
      type: "prompt",
      data: {
        prompt: "product photo",
        title: "主图",
        size: "1024x1024",
        quality: "high",
        outputDir: "output",
        status: "done",
        resultCount: 2,
      },
      selected: false,
      lod: true,
      onUpdate: vi.fn(),
      onRun: vi.fn(),
      onDelete: vi.fn(),
      sizeOptions: [{ value: "1024x1024", label: "1:1" }],
      qualityOptions: [{ value: "high", label: "high" }],
    });

    render(<ReactFlowProvider><PromptNode {...props} /></ReactFlowProvider>);

    expect(screen.getByText("主图")).toBeTruthy();
    expect(screen.getByText("完成 · 2 张")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "运行" })).toBeNull();
    // 抽象卡片保持与完整模式相同的宽度与最小高度（尺寸不缩水，字放大）
    const card = screen.getByText("主图").parentElement!;
    expect(card.className).toContain("!w-[380px]");
    expect(card.className).toContain("min-h-[320px]");
    expect(screen.getByText("主图").className).toContain("text-3xl");
    expect(screen.getByText("完成 · 2 张").className).toContain("text-xl");
  });

  it("renders a group node without hover delete actions in LOD mode", () => {
    const props = nodeProps<typeof GroupNode>({
      id: "group-1",
      type: "group",
      data: { name: "图片组", imageCount: 5, totalSize: 5 * 1024 * 1024 },
      selected: false,
      lod: true,
      onDelete: vi.fn(),
    });

    render(<ReactFlowProvider><GroupNode {...props} /></ReactFlowProvider>);

    expect(screen.getByText("5 张图")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除图片组" })).toBeNull();
  });

  it("shows a dedupe badge on the group card when the chain contains duplicates", () => {
    const props = nodeProps<typeof GroupNode>({
      id: "group-1",
      type: "group",
      data: { name: "图片组", imageCount: 3, totalSize: 3 * 1024 * 1024, duplicateCount: 2 },
      selected: false,
      onDelete: vi.fn(),
    });

    render(<ReactFlowProvider><GroupNode {...props} /></ReactFlowProvider>);

    // 数字直接是去重后的实际张数，重复只以「去重」标签提示
    expect(screen.getByText("3 张图")).toBeTruthy();
    expect(screen.getByText("去重")).toBeTruthy();
    expect(screen.queryByText(/去重实际/)).toBeNull();
  });

  it("omits the dedupe badge when the group has no duplicates", () => {
    const props = nodeProps<typeof GroupNode>({
      id: "group-1",
      type: "group",
      data: { name: "图片组", imageCount: 5, totalSize: 5 * 1024 * 1024 },
      selected: false,
      onDelete: vi.fn(),
    });

    render(<ReactFlowProvider><GroupNode {...props} /></ReactFlowProvider>);

    expect(screen.getByText("5 张图")).toBeTruthy();
    expect(screen.queryByText("去重")).toBeNull();
  });

  it("renders a failed prompt status without leaking the failure message into the card", () => {
    const props = nodeProps<typeof PromptNode>({
      id: "prompt-1",
      type: "prompt",
      data: {
        prompt: "product photo",
        size: "1024x1024",
        quality: "high",
        outputDir: "output",
        status: "failed",
        message: "secret provider detail",
      },
      selected: false,
      lod: true,
      onUpdate: vi.fn(),
      onRun: vi.fn(),
      onDelete: vi.fn(),
      sizeOptions: [{ value: "1024x1024", label: "1:1" }],
      qualityOptions: [{ value: "high", label: "high" }],
    });

    render(<ReactFlowProvider><PromptNode {...props} /></ReactFlowProvider>);

    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.queryByText("secret provider detail")).toBeNull();
  });
});
