// @vitest-environment jsdom

import { type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageNode, PromptNode } from "./CanvasNodes";

afterEach(cleanup);

function renderImageNode(onZoom = vi.fn(), onCanvasDoubleClick = vi.fn()) {
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
