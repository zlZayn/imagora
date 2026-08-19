import { describe, expect, it } from "vitest";

import type { WorkflowEdge, WorkflowNode } from "./types";
import { autoConnect, autoLayout, buildGroupNode, buildPromptNode, collectIncomingImages, extractAnimClasses, isImageFile, layoutPromptResults, layoutSelection, snapshotIncomingAbsPaths, staggerCreatePosition, updateSelectedPromptOutputDirs, withEnterAnim, workflowToCanvas } from "./workflow";

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

describe("prompt result layout", () => {
  it("centers existing and new results below the prompt without moving unrelated nodes", () => {
    const prompt = { ...promptNode("prompt"), position: { x: 400, y: 300 } } as WorkflowNode;
    const existing = { ...imageNode("existing"), position: { x: 900, y: 50 } } as WorkflowNode;
    const created = { ...imageNode("created"), position: { x: 0, y: 0 } } as WorkflowNode;
    const unrelated = { ...imageNode("unrelated"), position: { x: 75, y: 825 } } as WorkflowNode;
    const nodes = [prompt, existing, created, unrelated];
    const edges = [edge("prompt", "existing"), edge("prompt", "created")];

    const result = layoutPromptResults(nodes, edges, "prompt");
    const byId = new Map(result.map((node) => [node.id, node]));
    const first = byId.get("existing")!;
    const second = byId.get("created")!;

    expect(first.position.y).toBeGreaterThan(prompt.position.y + 300);
    expect(second.position.y).toBe(first.position.y);
    expect(first.position.x).toBeLessThan(second.position.x);
    const resultCenter = (first.position.x + 144 / 2 + second.position.x + 144 / 2) / 2;
    expect(resultCenter).toBe(prompt.position.x + 300 / 2);
    expect(byId.get("unrelated")).toBe(unrelated);
    expect(byId.get("prompt")).toBe(prompt);
  });
});

describe("auto layout", () => {
  it("lays out references, groups, prompts, and results in top-to-bottom bands", () => {
    const reference = { ...imageNode("reference"), position: { x: 0, y: 0 } } as WorkflowNode;
    const resultImage = { ...imageNode("result"), position: { x: 0, y: 0 } } as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 0, y: 0 },
      data: { name: "group", imageCount: 1, totalSize: 10 },
    } as WorkflowNode;
    const firstPrompt = promptNode("p1");
    const secondPrompt = promptNode("p2", 100);
    const nodes = [reference, group, firstPrompt, secondPrompt, resultImage];
    const edges = [
      edge("reference", "group"),
      edge("group", "p1"),
      edge("group", "p2"),
      edge("p1", "result"),
    ];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    expect(byId.get("reference")!.position.y).toBeLessThan(byId.get("group")!.position.y);
    expect(byId.get("group")!.position.y).toBeLessThan(byId.get("p1")!.position.y);
    expect(byId.get("p1")!.position.y).toBeLessThan(byId.get("result")!.position.y);
    expect(byId.get("p1")!.position.y).toBe(byId.get("p2")!.position.y);
    expect(byId.get("p1")!.position.x).toBeLessThan(byId.get("p2")!.position.x);
  });

  it("uses measured node heights so tall images do not overlap the next group", () => {
    const tallImage = {
      ...imageNode("tall", 0),
      measured: { width: 145, height: 274 },
    } as unknown as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 0, y: 1 },
      measured: { width: 244, height: 121 },
      data: { name: "group", imageCount: 1, totalSize: 10 },
    } as unknown as WorkflowNode;

    const result = autoLayout([tallImage, group], [edge("tall", "group")]);
    const imagePosition = result.find((node) => node.id === "tall")!.position;
    const groupPosition = result.find((node) => node.id === "group")!.position;

    expect(groupPosition.y).toBeGreaterThanOrEqual(imagePosition.y + 274 + 16);
  });

  it("does not trust a temporary image measurement smaller than its stable card", () => {
    const loadingImage = {
      ...imageNode("loading", 0),
      measured: { width: 144, height: 80 },
    } as unknown as WorkflowNode;
    const group = {
      id: "group",
      type: "group",
      position: { x: 0, y: 1 },
      data: { name: "group", imageCount: 1, totalSize: 10 },
    } as WorkflowNode;

    const result = autoLayout([loadingImage, group], [edge("loading", "group")]);
    const imagePosition = result.find((node) => node.id === "loading")!.position;
    const groupPosition = result.find((node) => node.id === "group")!.position;

    expect(groupPosition.y).toBeGreaterThanOrEqual(imagePosition.y + 220 + 16);
  });

  it("places wide orphan groups above prompts without vertical overlap", () => {
    const wideGroup = {
      id: "wide-group",
      type: "group",
      position: { x: 0, y: 0 },
      measured: { width: 300, height: 121 },
      data: { name: "group", imageCount: 0, totalSize: 0 },
    } as unknown as WorkflowNode;
    const prompt = promptNode("prompt");

    const result = autoLayout([wideGroup, prompt], []);
    const groupPosition = result.find((node) => node.id === "wide-group")!.position;
    const promptPosition = result.find((node) => node.id === "prompt")!.position;

    expect(promptPosition.y).toBeGreaterThanOrEqual(groupPosition.y + 121 + 60);
  });

  it("places a shared reference above a horizontal row of prompts", () => {
    const nodes = [imageNode("shared"), promptNode("p1"), promptNode("p2")];
    const edges = [edge("shared", "p1"), edge("shared", "p2")];

    const result = autoLayout(nodes, edges);
    const sharedY = result.find((node) => node.id === "shared")!.position.y;
    const first = result.find((node) => node.id === "p1")!;
    const second = result.find((node) => node.id === "p2")!;
    const firstY = first.position.y;
    const secondY = second.position.y;

    expect(sharedY).toBeLessThan(firstY);
    expect(firstY).toBe(secondY);
    expect(first.position.x).toBeLessThan(second.position.x);
  });

  it("places orphan images in the top band above prompts", () => {
    const nodes = [
      imageNode("orphan-1", 10),
      imageNode("orphan-2", 20),
      imageNode("orphan-3", 30),
      imageNode("orphan-4", 40),
      promptNode("p1"),
    ];

    const result = autoLayout(nodes, []);
    const promptY = result.find((node) => node.id === "p1")!.position.y;

    for (const node of result.filter((item) => item.type === "image")) {
      expect(node.position.y).toBeLessThan(promptY);
    }
    expect(promptY).toBeGreaterThanOrEqual(40 + 180 + 60);
  });
});

describe("auto layout complex connections", () => {
  function groupNode(id: string): WorkflowNode {
    return {
      id,
      type: "group",
      position: { x: 0, y: 0 },
      data: { name: id, imageCount: 0, totalSize: 0 },
    } as WorkflowNode;
  }

  it("keeps a reused result flowing downward (prompt → result → group → prompt) instead of crossing back up", () => {
    const nodes = [promptNode("p1"), imageNode("result"), groupNode("group"), promptNode("p2")];
    const edges = [edge("p1", "result"), edge("result", "group"), edge("group", "p2")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    expect(byId.get("p1")!.position.y).toBeLessThan(byId.get("result")!.position.y);
    expect(byId.get("result")!.position.y).toBeLessThan(byId.get("group")!.position.y);
    expect(byId.get("group")!.position.y).toBeLessThan(byId.get("p2")!.position.y);
  });

  it("lays out multi-level chains strictly downward (image → prompt → result → group → prompt → result)", () => {
    const nodes = [imageNode("img"), promptNode("p1"), imageNode("r1"), groupNode("group"), promptNode("p2"), imageNode("r2")];
    const edges = [
      edge("img", "p1"),
      edge("p1", "r1"),
      edge("r1", "group"),
      edge("group", "p2"),
      edge("p2", "r2"),
    ];

    const arranged = autoLayout(nodes, edges);
    const ys = arranged.map((node) => node.position.y);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i - 1]).toBeLessThan(ys[i]);
    }
  });

  it("places a result reused as a direct reference below its source prompt", () => {
    const nodes = [promptNode("p1"), imageNode("img"), promptNode("p2")];
    const edges = [edge("p1", "img"), edge("img", "p2")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    expect(byId.get("p1")!.position.y).toBeLessThan(byId.get("img")!.position.y);
    expect(byId.get("img")!.position.y).toBeLessThan(byId.get("p2")!.position.y);
  });

  it("tolerates a cycle (result fed back as its own reference) without hanging", () => {
    const nodes = [promptNode("p1"), imageNode("img")];
    const edges = [edge("p1", "img"), edge("img", "p1")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    for (const id of ["p1", "img"]) {
      expect(Number.isFinite(byId.get(id)!.position.x)).toBe(true);
      expect(Number.isFinite(byId.get(id)!.position.y)).toBe(true);
    }
  });

  it("centers multiple results as a block under their prompt", () => {
    const p1 = { ...promptNode("p1"), position: { x: 400, y: 300 } } as WorkflowNode;
    const nodes = [p1, imageNode("r1"), imageNode("r2")];
    const edges = [edge("p1", "r1"), edge("p1", "r2")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    const promptCenter = byId.get("p1")!.position.x + 300 / 2;
    const first = byId.get("r1")!;
    const second = byId.get("r2")!;
    const blockCenter = (first.position.x + 144 / 2 + second.position.x + 144 / 2) / 2;
    expect(Math.abs(blockCenter - promptCenter)).toBeLessThanOrEqual(3);
    expect(first.position.y).toBe(second.position.y);
  });
});

describe("layout selection", () => {
  it("re-arranges only selected nodes, leaving unselected positions untouched", () => {
    const reference = { ...imageNode("reference"), position: { x: 10, y: 20 } } as WorkflowNode;
    const orphan = { ...imageNode("orphan"), position: { x: 500, y: 500 } } as WorkflowNode;
    const prompt = { ...promptNode("p1", 0), position: { x: 400, y: 300 } } as WorkflowNode;
    const result = { ...imageNode("result"), position: { x: 410, y: 900 } } as WorkflowNode;
    const nodes = [reference, orphan, prompt, result];
    const edges = [edge("reference", "p1"), edge("p1", "result")];

    // 只选中 reference + prompt + result（orphan 不参与）
    const arranged = layoutSelection(nodes, edges, new Set(["reference", "p1", "result"]));
    const byId = new Map(arranged.map((node) => [node.id, node]));

    // 未选中节点坐标完全不变
    expect(byId.get("orphan")!.position).toEqual({ x: 500, y: 500 });
    // 选中节点重排：参考图在提示词上方，提示词在结果上方（保持三段式相对关系）
    expect(byId.get("reference")!.position.y).toBeLessThan(byId.get("p1")!.position.y);
    expect(byId.get("p1")!.position.y).toBeLessThan(byId.get("result")!.position.y);
    // 平移起点是选中包围盒左上角：布局不从画布 (60,40) 起，而从选中块内开始
    expect(byId.get("reference")!.position.x).toBeGreaterThanOrEqual(10);
  });

  it("returns nodes unchanged when nothing is selected", () => {
    const nodes = [{ ...promptNode("p1"), position: { x: 100, y: 100 } } as WorkflowNode];
    const result = layoutSelection(nodes, [], new Set());
    expect(result).toBe(nodes);
    expect(result[0].position).toEqual({ x: 100, y: 100 });
  });

  it("re-layout on the same selection does not drift right/down (origin is the anchor, not an offset)", () => {
    // 选中的块随意摆放在画布深处，origin = 选中包围盒左上角
    const reference = { ...imageNode("reference"), position: { x: 310, y: 220 } } as WorkflowNode;
    const prompt = { ...promptNode("p1", 0), position: { x: 400, y: 300 } } as WorkflowNode;
    const result = { ...imageNode("result"), position: { x: 410, y: 900 } } as WorkflowNode;
    const nodes = [reference, prompt, result];
    const edges = [edge("reference", "p1"), edge("p1", "result")];
    const selected = new Set(["reference", "p1", "result"]);

    // 第一次整理：以选中块左上角 (310, 220) 为原点重排
    const first = layoutSelection(nodes, edges, selected);
    const firstMinX = Math.min(...first.filter((n) => selected.has(n.id)).map((n) => n.position.x));
    const firstMinY = Math.min(...first.filter((n) => selected.has(n.id)).map((n) => n.position.y));

    // 第二次整理（用第一次结果 + 同样的包围盒原点）：不应再整体位移
    const second = layoutSelection(first, edges, selected);
    const secondMinX = Math.min(...second.filter((n) => selected.has(n.id)).map((n) => n.position.x));
    const secondMinY = Math.min(...second.filter((n) => selected.has(n.id)).map((n) => n.position.y));

    // 核心断言：二次整理后选中块包围盒原点不变（无 60/40 累积漂移）
    expect(secondMinX).toBe(firstMinX);
    expect(secondMinY).toBe(firstMinY);
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
