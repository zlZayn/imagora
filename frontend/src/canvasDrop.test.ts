import { describe, expect, it } from "vitest";

import {
  countDraggedFiles,
  dragCarriesFiles,
  dropChipLabel,
  extractImageFiles,
  resolveDropIntent,
} from "./canvasDrop";

/** 构造最小 dataTransfer 桩：jsdom 的 DataTransfer 实现不完整，用桩保证测试只依赖类型契约 */
function stubDataTransfer(overrides: Partial<DataTransfer> = {}): DataTransfer {
  return {
    types: [],
    getData: () => "",
    items: [],
    files: [],
    ...overrides,
  } as unknown as DataTransfer;
}

/** 拖拽事件桩：只暴露意图解析用到的 dataTransfer 字段 */
function stubDragEvent(overrides: Partial<DataTransfer> = {}): { dataTransfer: DataTransfer | null } {
  return { dataTransfer: stubDataTransfer(overrides) };
}

const IMAGE_MIME = "application/x-imagora-canvas";

describe("dragCarriesFiles", () => {
  it("detects file drags by the Files type", () => {
    expect(dragCarriesFiles(stubDragEvent({ types: ["Files"] }))).toBe(true);
  });

  it("ignores text drags and missing dataTransfer", () => {
    expect(dragCarriesFiles(stubDragEvent({ types: ["text/plain"] }))).toBe(false);
    expect(dragCarriesFiles({ dataTransfer: null })).toBe(false);
  });
});

describe("resolveDropIntent", () => {
  it("resolves file drags to images regardless of the fallback", () => {
    const event = stubDragEvent({ types: ["Files"] });
    expect(resolveDropIntent(event, "group")).toBe("images");
  });

  it("resolves toolbar button drags from the custom type", () => {
    const prompt = stubDragEvent({
      types: [IMAGE_MIME],
      getData: (type) => (type === IMAGE_MIME ? "prompt" : ""),
    });
    const group = stubDragEvent({
      types: [IMAGE_MIME],
      getData: (type) => (type === IMAGE_MIME ? "group" : ""),
    });
    expect(resolveDropIntent(prompt, null)).toBe("prompt");
    expect(resolveDropIntent(group, null)).toBe("group");
  });

  it("passes unrelated drags through and uses the fallback when getData is empty", () => {
    const textDrag = stubDragEvent({ types: ["text/plain"] });
    expect(resolveDropIntent(textDrag, "prompt")).toBe("prompt");
    expect(resolveDropIntent(textDrag, null)).toBe(null);
  });
});

describe("countDraggedFiles", () => {
  it("counts only file-kind items (dragover has no dataTransfer.files)", () => {
    const items = [
      { kind: "file" },
      { kind: "file" },
      { kind: "string" },
    ] as unknown as DataTransferItemList;
    expect(countDraggedFiles(stubDataTransfer({ items }))).toBe(2);
  });

  it("returns 0 for missing dataTransfer", () => {
    expect(countDraggedFiles(null)).toBe(0);
  });
});

describe("extractImageFiles", () => {
  it("keeps only image files at drop time", () => {
    const png = new File([""], "a.png", { type: "image/png" });
    const txt = new File([""], "b.txt", { type: "text/plain" });
    const files = [png, txt] as unknown as FileList;
    expect(extractImageFiles(stubDataTransfer({ files }))).toEqual([png]);
  });
});

describe("dropChipLabel", () => {
  it("shows the dragged file count for image drags", () => {
    expect(dropChipLabel("images", 3)).toBe("松开添加 3 张图片");
  });

  it("shows a clear hint when no image is detected", () => {
    expect(dropChipLabel("images", 0)).toBe("未检测到图片");
  });

  it("shows the node type for toolbar button drags", () => {
    expect(dropChipLabel("prompt", 0)).toBe("松开新建提示词卡片");
    expect(dropChipLabel("group", 0)).toBe("松开新建图片组");
  });
});
