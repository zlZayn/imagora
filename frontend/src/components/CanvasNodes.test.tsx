// @vitest-environment jsdom

import { type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupNode, ImageNode, PromptNode } from "./CanvasNodes";

afterEach(cleanup);

function renderImageNode(onZoom = vi.fn(), onCanvasDoubleClick = vi.fn(), lod?: boolean) {
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
    lod,
    onZoom,
    onReplace: vi.fn(),
    onDelete: vi.fn(),
  } as unknown as ComponentProps<typeof ImageNode>;

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
    const props = {
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
    } as unknown as ComponentProps<typeof PromptNode>;

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
    const props = {
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
    } as unknown as ComponentProps<typeof PromptNode>;

    render(<ReactFlowProvider><PromptNode {...props} /></ReactFlowProvider>);

    expect(screen.getByText("主图")).toBeTruthy();
    expect(screen.getByText("完成 · 2 张")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "运行" })).toBeNull();
    // 抽象卡片保持与完整模式相同的宽度与最小高度（尺寸不缩水，字放大）
    const card = screen.getByText("主图").parentElement!;
    expect(card.className).toContain("!w-[380px]");
    expect(card.className).toContain("min-h-[320px]");
  });

  it("renders a group node without hover delete actions in LOD mode", () => {
    const props = {
      id: "group-1",
      type: "group",
      data: { name: "图片组", imageCount: 5, totalSize: 5 * 1024 * 1024 },
      selected: false,
      lod: true,
      onDelete: vi.fn(),
    } as unknown as ComponentProps<typeof GroupNode>;

    render(<ReactFlowProvider><GroupNode {...props} /></ReactFlowProvider>);

    expect(screen.getByText("5 张图")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除图片组" })).toBeNull();
  });

  it("renders a failed prompt status without leaking the failure message into the card", () => {
    const props = {
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
    } as unknown as ComponentProps<typeof PromptNode>;

    render(<ReactFlowProvider><PromptNode {...props} /></ReactFlowProvider>);

    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.queryByText("secret provider detail")).toBeNull();
  });
});
