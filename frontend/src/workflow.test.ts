import { describe, expect, it } from "vitest";

import type { WorkflowEdge, WorkflowNode } from "./types";
import { autoConnect, autoConnectSelection, buildGroupNode, buildPromptNode, collectIncomingImages, extractAnimClasses, isImageFile, mergeSubmissionGraph, snapshotIncomingAbsPaths, staggerCreatePosition, updateSelectedPromptOutputDirs, withEnterAnim, workflowToCanvas } from "./workflow";

function promptNode(id: string, y = 0): WorkflowNode {
  return {
    id,
    type: "prompt",
    position: { x: 0, y },
    data: {
      prompt: id,
      size: "1024x1024",
      quality: "high",
      outputDir: "output",
      status: "idle",
    },
  } as WorkflowNode;
}

function imageNode(id: string, y = 0): WorkflowNode {
  return {
    id,
    type: "image",
    position: { x: 0, y },
    data: {
      registryId: id,
      name: `${id}.png`,
      url: `/api/image?path=${id}`,
      size: 10,
      ext: "png",
      refCount: 0,
      absPath: `C:\\output\\${id}.png`,
    },
  } as WorkflowNode;
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target };
}

describe("workflow defaults", () => {
  it("uses high for a legacy prompt without quality", () => {
    const legacyPrompt = {
      id: "p1",
      type: "prompt",
      position: { x: 0, y: 0 },
      data: {
        prompt: "product photo",
        size: "1024x1024",
        outputDir: "output",
        status: "idle",
      },
    } as unknown as WorkflowNode;

    const result = workflowToCanvas([legacyPrompt], [], []);
    const prompt = result.nodes[0];

    expect(prompt.type === "prompt" && prompt.data.quality).toBe("high");
  });
});

describe("prompt output directory updates", () => {
  it("updates only selected prompt nodes in a mixed selection", () => {
    const selectedPrompt = promptNode("selected-prompt");
    const untouchedPrompt = promptNode("untouched-prompt");
    const selectedImage = imageNode("selected-image");
    const group = {
      id: "selected-group",
      type: "group",
      position: { x: 0, y: 0 },
      data: { name: "group", imageCount: 0, totalSize: 0 },
    } as WorkflowNode;
    const nodes = [selectedPrompt, untouchedPrompt, selectedImage, group];

    const result = updateSelectedPromptOutputDirs(
      nodes,
      new Set(["selected-prompt", "selected-image", "selected-group"]),
      "D:\\outputs\\campaign",
    );

    expect(result.changedCount).toBe(1);
    expect(result.nodes.find((node) => node.id === "selected-prompt")!.data.outputDir).toBe("D:\\outputs\\campaign");
    expect(result.nodes.find((node) => node.id === "untouched-prompt")).toBe(untouchedPrompt);
    expect(result.nodes.find((node) => node.id === "selected-image")).toBe(selectedImage);
    expect(result.nodes.find((node) => node.id === "selected-group")).toBe(group);
  });

  it("returns the original node array when no selected prompt changes", () => {
    const nodes = [promptNode("prompt"), imageNode("image")];

    const result = updateSelectedPromptOutputDirs(nodes, new Set(["image"]), "D:\\outputs");

    expect(result).toEqual({ nodes, changedCount: 0 });
    expect(result.nodes).toBe(nodes);
  });
});

describe("auto connect", () => {
  it("uses vertical position to distinguish references from generated results", () => {
    const topImage = { ...imageNode("top-image"), position: { x: 0, y: 0 } } as WorkflowNode;
    const prompt = { ...promptNode("prompt"), position: { x: 0, y: 400 } } as WorkflowNode;
    const bottomImage = { ...imageNode("bottom-image"), position: { x: 0, y: 900 } } as WorkflowNode;

    expect(autoConnect([topImage, prompt, bottomImage], [])).toEqual([
      edge("top-image", "prompt"),
      edge("prompt", "bottom-image"),
    ]);
  });

  it("keeps a result image connected from its prompt even when a lower group is closer", () => {
    const prompt = { ...promptNode("prompt"), position: { x: 0, y: 300 } } as WorkflowNode;
    const resultImage = { ...imageNode("result"), position: { x: 0, y: 700 } } as WorkflowNode;
    const lowerGroup = {
      id: "lower-group",
      type: "group",
      position: { x: 0, y: 720 },
      data: { name: "group", imageCount: 0, totalSize: 0 },
    } as WorkflowNode;

    expect(autoConnect([prompt, resultImage, lowerGroup], [])).toEqual([
      edge("prompt", "result"),
      edge("lower-group", "prompt"),
    ]);
  });

  it("connects orphan images to a group even when there is no prompt node", () => {
    const image = { ...imageNode("image"), position: { x: 0, y: 0 } } as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 200, y: 0 },
      data: { name: "group", imageCount: 0, totalSize: 0 },
    } as WorkflowNode;

    expect(autoConnect([image, group], [])).toEqual([edge("image", "group")]);
  });

  it("connects orphan images by top/bottom position and groups to the nearest prompt", () => {
    const top = { ...imageNode("top"), position: { x: 0, y: 0 } } as WorkflowNode;
    const bottom = { ...imageNode("bottom"), position: { x: 700, y: 900 } } as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 100, y: 600 },
      data: { name: "group", imageCount: 0, totalSize: 0 },
    } as WorkflowNode;
    const prompt = { ...promptNode("prompt"), position: { x: 350, y: 300 } } as WorkflowNode;

    expect(autoConnect([top, bottom, group, prompt], [])).toEqual([
      edge("top", "prompt"),
      edge("prompt", "bottom"),
      edge("group", "prompt"),
    ]);
  });

  it("keeps existing edges and does not reconnect nodes that already participate", () => {
    const left = { ...imageNode("left"), position: { x: 0, y: 0 } } as WorkflowNode;
    const prompt = { ...promptNode("prompt"), position: { x: 350, y: 0 } } as WorkflowNode;
    const existing = edge("left", "prompt");

    expect(autoConnect([left, prompt], [existing])).toEqual([existing]);
  });

  it("completes a group that already has images but is not connected to a prompt", () => {
    const image = { ...imageNode("image"), position: { x: 0, y: 0 } } as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 200, y: 0 },
      data: { name: "group", imageCount: 1, totalSize: 10 },
    } as WorkflowNode;
    const prompt = { ...promptNode("prompt"), position: { x: 500, y: 0 } } as WorkflowNode;
    const existing = edge("image", "group");

    expect(autoConnect([image, group, prompt], [existing])).toEqual([
      existing,
      edge("group", "prompt"),
    ]);
  });

  it("connects newly added prompt cards to an already used populated group", () => {
    const image = { ...imageNode("image"), position: { x: 0, y: 0 } } as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 200, y: 0 },
      data: { name: "group", imageCount: 1, totalSize: 10 },
    } as WorkflowNode;
    const firstPrompt = { ...promptNode("p1"), position: { x: 500, y: 0 } } as WorkflowNode;
    const newPrompt = { ...promptNode("p2"), position: { x: 500, y: 500 } } as WorkflowNode;
    const existing = [edge("image", "group"), edge("group", "p1")];

    expect(autoConnect([image, group, firstPrompt, newPrompt], existing)).toEqual([
      ...existing,
      edge("group", "p2"),
    ]);
  });
});

describe("auto connect selection", () => {
  it("connects only selected orphan nodes, leaving unselected nodes untouched", () => {
    const orphanA = { ...imageNode("a"), position: { x: 0, y: 0 } } as WorkflowNode;
    const promptB = { ...promptNode("b"), position: { x: 200, y: 400 } } as WorkflowNode;
    const unselected = { ...imageNode("unselected"), position: { x: 900, y: 0 } } as WorkflowNode;

    const result = autoConnectSelection(
      [orphanA, promptB, unselected],
      [],
      new Set(["a", "b"]),
    );

    expect(result).toEqual([edge("a", "b")]);
  });

  it("connects nothing when the selection cannot form a pair", () => {
    const image = { ...imageNode("image"), position: { x: 0, y: 0 } } as WorkflowNode;

    const result = autoConnectSelection([image], [], new Set(["image"]));

    expect(result).toEqual([]);
  });

  it("reuses existing edges and never adds edges touching unselected nodes", () => {
    const image = { ...imageNode("image"), position: { x: 0, y: 0 } } as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 0, y: 200 },
      data: { name: "group", imageCount: 1, totalSize: 10 },
    } as WorkflowNode;
    const prompt = { ...promptNode("prompt"), position: { x: 0, y: 400 } } as WorkflowNode;
    const existing = edge("image", "group");

    // 选中 group + prompt：group 已有未选中图片入边，只补 group -> prompt
    const result = autoConnectSelection(
      [image, group, prompt],
      [existing],
      new Set(["group", "prompt"]),
    );

    expect(result).toEqual([existing, edge("group", "prompt")]);
  });

  it("returns edges unchanged when nothing is selected", () => {
    const image = { ...imageNode("image"), position: { x: 0, y: 0 } } as WorkflowNode;
    const prompt = { ...promptNode("prompt"), position: { x: 0, y: 400 } } as WorkflowNode;
    const existing = edge("image", "prompt");

    expect(autoConnectSelection([image, prompt], [existing], new Set())).toEqual([existing]);
  });
});

describe("incoming reference images", () => {
  it("collects direct and group-expanded images for a prompt", () => {
    const image = imageNode("img1");
    const group = {
      id: "group",
      type: "group",
      position: { x: 0, y: 0 },
      data: { name: "group", imageCount: 2, totalSize: 20 },
    } as WorkflowNode;
    const groupImage = imageNode("img2");
    const prompt = promptNode("p1");

    const images = collectIncomingImages(
      [image, group, groupImage, prompt],
      [edge("img1", "group"), edge("img2", "group"), edge("group", "p1")],
      "p1",
    );

    expect(images.map((n) => n.id).sort()).toEqual(["img1", "img2"]);
  });

  it("dedupes on cycles (image reachable via two paths is collected once)", () => {
    const image = imageNode("img1");
    const prompt = promptNode("p1");

    const images = collectIncomingImages(
      [image, prompt],
      [edge("img1", "p1"), edge("p1", "img1")],
      "p1",
    );

    expect(images.map((n) => n.id)).toEqual(["img1"]);
  });

  it("snapshot skips images without absPath (missing) instead of pushing undefined", () => {
    const present = imageNode("ok");
    const missing = {
      ...imageNode("gone"),
      data: { ...imageNode("gone").data, absPath: undefined },
    } as WorkflowNode;
    const prompt = promptNode("p1");

    const paths = snapshotIncomingAbsPaths(
      [present, missing, prompt],
      [edge("ok", "p1"), edge("gone", "p1")],
      "p1",
    );

    expect(paths).toEqual([`C:\\output\\ok.png`]);
  });
});

describe("animation class helpers", () => {
  it("strips runtime animation classes from node className on load", () => {
    const node = { ...imageNode("a"), className: "node-enter enter-delay-2 node-related" } as WorkflowNode;
    const result = workflowToCanvas([node], [], []);
    expect(result.nodes[0].className).toBe("node-related");
  });

  it("removes the exit marker so a restored workflow never lingers in fade-out", () => {
    const node = { ...imageNode("b"), className: "node-exiting" } as WorkflowNode;
    const result = workflowToCanvas([node], [], []);
    expect(result.nodes[0].className).toBeUndefined();
  });

  it("extracts only animation classes for highlight merging", () => {
    expect(extractAnimClasses("node-enter enter-delay-1 node-related")).toBe("node-enter enter-delay-1");
    expect(extractAnimClasses("node-related")).toBe("");
    expect(extractAnimClasses(undefined)).toBe("");
  });

  it("adds staggered enter classes by index", () => {
    const first = withEnterAnim(imageNode("a"), 0);
    const second = withEnterAnim(imageNode("b"), 2);
    expect(first.className).toContain("node-enter");
    expect(first.className).toContain("enter-delay-1");
    expect(second.className).toContain("enter-delay-3");
  });
});

describe("create position stagger", () => {
  const center = { x: 659, y: 334.5 };

  it("uses the viewport center when there is no previous position", () => {
    expect(staggerCreatePosition(center, null)).toEqual({ position: center, next: center });
  });

  it("stacks +30px when the viewport barely moved (consecutive creates)", () => {
    const first = staggerCreatePosition(center, null);
    const second = staggerCreatePosition(center, first.next);
    expect(second.position).toEqual({ x: center.x + 30, y: center.y + 30 });
    const third = staggerCreatePosition(center, second.next);
    expect(third.position).toEqual({ x: center.x + 60, y: center.y + 60 });
  });

  it("returns to the center after the viewport moved far away", () => {
    const last = { x: center.x + 30, y: center.y + 30 };
    const farCenter = { x: center.x + 3000, y: center.y - 2000 };
    expect(staggerCreatePosition(farCenter, last)).toEqual({ position: farCenter, next: farCenter });
  });

  it("never drifts with node count (no modulo-of-total cascade)", () => {
    // 模拟画布已有 23 个节点时创建：落点仍以中心为基准，而不是 150px 偏移
    const last = { x: center.x + 30, y: center.y + 30 };
    const result = staggerCreatePosition(center, last);
    expect(Math.abs(result.position.x - center.x)).toBeLessThanOrEqual(60);
    expect(Math.abs(result.position.y - center.y)).toBeLessThanOrEqual(60);
  });
});

describe("image file detection", () => {
  const file = (name: string, type: string) => new File([""], name, { type });

  it("accepts files with an image MIME type", () => {
    expect(isImageFile(file("photo.png", "image/png"))).toBe(true);
    expect(isImageFile(file("photo", "image/webp"))).toBe(true);
  });

  it("falls back to the extension when the MIME type is missing", () => {
    // 部分系统拖拽/粘贴不携带 MIME 类型，此时按扩展名兜底识别
    expect(isImageFile(file("photo.JPG", ""))).toBe(true);
    expect(isImageFile(file("photo.jpeg", ""))).toBe(true);
    expect(isImageFile(file("photo.webp", ""))).toBe(true);
    expect(isImageFile(file("photo.gif", ""))).toBe(true);
    expect(isImageFile(file("photo.bmp", ""))).toBe(true);
  });

  it("rejects non-image files even with a MIME-like type", () => {
    expect(isImageFile(file("notes.txt", "text/plain"))).toBe(false);
    expect(isImageFile(file("notes.txt", ""))).toBe(false);
    expect(isImageFile(file("archive.png.zip", "application/zip"))).toBe(false);
  });
});

describe("canvas node builders", () => {
  it("builds a prompt node with the given defaults at the position", () => {
    const node = buildPromptNode(
      { x: 10, y: 20 },
      { size: "1024x1024", quality: "high", outputDir: "output" },
    );
    expect(node.type).toBe("prompt");
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.data).toMatchObject({
      prompt: "",
      size: "1024x1024",
      quality: "high",
      outputDir: "output",
      status: "idle",
    });
  });

  it("builds a group node at the position with default counters", () => {
    const node = buildGroupNode({ x: 30, y: 40 });
    expect(node.type).toBe("group");
    expect(node.position).toEqual({ x: 30, y: 40 });
    expect(node.data).toMatchObject({ name: "图片组", imageCount: 0, totalSize: 0 });
  });
});

describe("mergeSubmissionGraph", () => {
  const subPrompt: WorkflowNode = {
    id: "prompt-sub-1", type: "prompt", position: { x: 0, y: 0 },
    data: { prompt: "p", size: "s", quality: "q", outputDir: "o", status: "idle" },
  } as WorkflowNode;
  const subImg: WorkflowNode = {
    id: "img-aaa", type: "image", position: { x: 0, y: 0 },
    data: { registryId: "aaa", name: "aaa.png", size: 1, ext: "png", refCount: 0 },
  } as WorkflowNode;
  const subResult: WorkflowNode = {
    id: "img-bbb", type: "image", position: { x: 0, y: 0 },
    data: { registryId: "bbb", name: "bbb.png", size: 1, ext: "png", refCount: 0 },
  } as WorkflowNode;
  const subEdges: WorkflowEdge[] = [
    { id: "prompt-sub-1->img-bbb", source: "prompt-sub-1", target: "img-bbb" },
  ];

  it("appends new nodes, maps edges, and reuses image nodes already present", () => {
    // 画布已存在同 registryId 的图片节点 bbb
    const existingImg: WorkflowNode = {
      id: "img-bbb", type: "image", position: { x: 0, y: 0 },
      data: { registryId: "bbb", name: "old.png", size: 1, ext: "png", refCount: 0 },
    } as WorkflowNode;
    const existingEdges: WorkflowEdge[] = [];
    const out = mergeSubmissionGraph([subPrompt, subImg, subResult], subEdges, [existingImg], existingEdges, "sub-1");
    // 已有 bbb 复用，不新增；新增 prompt + aaa
    const imageIds = out.nodes.filter((n) => n.type === "image").map((n) => n.data.registryId);
    expect(imageIds).toContain("bbb");
    expect(imageIds).toContain("aaa");
    const bbbCount = out.nodes.filter((n) => n.type === "image" && n.data.registryId === "bbb").length;
    expect(bbbCount).toBe(1); // 去重
    // prompt 用命名空间 id
    const promptIds = out.nodes.filter((n) => n.type === "prompt").map((n) => n.id);
    expect(promptIds).toEqual(["prompt-sub-1-import-sub-1"]);
    // 边映射到复用/新增节点，源为实际落点
    const edge = out.edges.find((e) => e.target === "img-bbb")!;
    expect(edge).toBeTruthy();
    expect(edge.source).toBe("prompt-sub-1-import-sub-1");
  });
});
