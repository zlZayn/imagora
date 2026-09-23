import { describe, expect, it } from "vitest";

import type { WorkflowEdge, WorkflowNode } from "./types";
import { autoLayout, layoutPromptResults, layoutSelection, nodeSize } from "./layout";

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

function groupNode(id: string): WorkflowNode {
  return {
    id,
    type: "group",
    position: { x: 0, y: 0 },
    data: { name: id, imageCount: 0, totalSize: 0 },
  } as WorkflowNode;
}

function withPromptTitle(id: string, title: string): WorkflowNode {
  return {
    ...promptNode(id),
    data: { ...promptNode(id).data, title },
  } as WorkflowNode;
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target };
}

/** 测试用：measured 由 React Flow 运行期注入、不在 WorkflowNode 类型上，用交点返回类型显式带上 */
function withMeasured(
  node: WorkflowNode,
  width: number,
  height: number,
): WorkflowNode & { measured: { width: number; height: number } } {
  return { ...node, measured: { width, height } };
}

function center(node: WorkflowNode): number {
  return node.position.x + nodeSize(node).width / 2;
}

function horizontalGap(a: WorkflowNode, b: WorkflowNode): number {
  return b.position.x - (a.position.x + nodeSize(a).width);
}

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
    const resultCenter = (center(first) + center(second)) / 2;
    expect(Math.abs(resultCenter - (prompt.position.x + 300 / 2))).toBeLessThanOrEqual(1);
    expect(byId.get("unrelated")).toBe(unrelated);
    expect(byId.get("prompt")).toBe(prompt);
  });
});

describe("auto layout", () => {
  it("lays out references, groups, prompts, and results in top-to-bottom bands", () => {
    const reference = { ...imageNode("reference"), position: { x: 0, y: 0 } } as WorkflowNode;
    const resultImage = { ...imageNode("result"), position: { x: 0, y: 0 } } as WorkflowNode;
    const group = groupNode("group");
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
    const tallImage = withMeasured(imageNode("tall", 0), 145, 274);
    const group = withMeasured(groupNode("group"), 244, 121);

    const result = autoLayout([tallImage, group], [edge("tall", "group")]);
    const imagePosition = result.find((node) => node.id === "tall")!.position;
    const groupPosition = result.find((node) => node.id === "group")!.position;

    expect(groupPosition.y).toBeGreaterThanOrEqual(imagePosition.y + 274 + 16);
  });

  it("does not trust a temporary image measurement smaller than its stable card", () => {
    const loadingImage = withMeasured(imageNode("loading", 0), 144, 80);
    const group = groupNode("group");

    const result = autoLayout([loadingImage, group], [edge("loading", "group")]);
    const imagePosition = result.find((node) => node.id === "loading")!.position;
    const groupPosition = result.find((node) => node.id === "group")!.position;

    expect(groupPosition.y).toBeGreaterThanOrEqual(imagePosition.y + 220 + 16);
  });

  it("places wide orphan groups above prompts without vertical overlap", () => {
    const wideGroup = withMeasured(groupNode("wide-group"), 300, 121);
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

  it("orders prompt cards left-to-right by their top-left title in the same band", () => {
    const shared = imageNode("shared");
    const nodes = [
      shared,
      withPromptTitle("p-b", "Beta"),
      withPromptTitle("p-a", "Alpha"),
      withPromptTitle("p-c", "Gamma"),
    ];
    const edges = [edge("shared", "p-a"), edge("shared", "p-b"), edge("shared", "p-c")];

    const arranged = autoLayout(nodes, edges);
    const prompts = arranged
      .filter((node) => node.type === "prompt")
      .sort((a, b) => a.position.x - b.position.x);
    const texts = prompts.map((node) => (node.type === "prompt" ? node.data.title : ""));
    // 同一参考来源（shared）组内从左到右按标题升序：Alpha < Beta < Gamma
    expect(texts).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(prompts[0].position.x).toBeLessThan(prompts[1].position.x);
    expect(prompts[1].position.x).toBeLessThan(prompts[2].position.x);
  });

  it("defaults the title sort key for prompt cards without one", () => {
    // 无标题卡片与标题卡片同层：缺省标题「提示词生成」参与排序，不抛异常、产出确定位置
    const nodes = [withPromptTitle("p-a", "Alpha"), { ...promptNode("p-b"), position: { x: 90, y: 0 } }];
    const arranged = autoLayout(nodes, []);
    const prompts = arranged.filter((node) => node.type === "prompt");

    expect(prompts.length).toBe(2);
    expect(prompts.every((n) => Number.isFinite(n.position.x))).toBe(true);
    expect(new Set(prompts.map((n) => n.position.x)).size).toBe(2);
  });
});

describe("auto layout complex connections", () => {
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
    const blockCenter = (center(first) + center(second)) / 2;
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

    const first = layoutSelection(nodes, edges, selected);
    const firstMinX = Math.min(...first.filter((n) => selected.has(n.id)).map((n) => n.position.x));
    const firstMinY = Math.min(...first.filter((n) => selected.has(n.id)).map((n) => n.position.y));

    const second = layoutSelection(first, edges, selected);
    const secondMinX = Math.min(...second.filter((n) => selected.has(n.id)).map((n) => n.position.x));
    const secondMinY = Math.min(...second.filter((n) => selected.has(n.id)).map((n) => n.position.y));

    // 核心断言：二次整理后选中块包围盒原点不变（无 60/40 累积漂移）
    expect(secondMinX).toBe(firstMinX);
    expect(secondMinY).toBe(firstMinY);
  });
});

describe("layout anchors", () => {
  it("aligns a selected prompt to its unselected reference image without moving the anchor", () => {
    const ref = { ...imageNode("ref"), position: { x: 300, y: 100 } } as WorkflowNode;
    const prompt = { ...promptNode("p"), position: { x: 0, y: 0 } } as WorkflowNode;
    const nodes = [ref, prompt];

    const result = layoutSelection(nodes, [edge("ref", "p")], new Set(["p"]));
    const byId = new Map(result.map((node) => [node.id, node]));

    expect(byId.get("ref")).toBe(ref);
    const p = byId.get("p")!;
    expect(Math.abs(center(p) - center(ref))).toBeLessThanOrEqual(1);
    expect(p.position.y).toBeGreaterThanOrEqual(ref.position.y + nodeSize(ref).height + 55);
  });

  it("aligns a selected image to its unselected prompt column", () => {
    const image = { ...imageNode("img"), position: { x: 0, y: 0 } } as WorkflowNode;
    const prompt = { ...promptNode("p"), position: { x: 500, y: 800 } } as WorkflowNode;
    const nodes = [image, prompt];

    const result = layoutSelection(nodes, [edge("img", "p")], new Set(["img"]));
    const byId = new Map(result.map((node) => [node.id, node]));

    expect(byId.get("p")).toBe(prompt);
    expect(Math.abs(center(byId.get("img")!) - center(prompt))).toBeLessThanOrEqual(1);
  });
});

describe("layout balancing", () => {
  it("centers selected bands inside a wide selection box", () => {
    const a = { ...imageNode("a"), position: { x: 0, y: 0 } } as WorkflowNode;
    const b = { ...imageNode("b"), position: { x: 1000, y: 0 } } as WorkflowNode;
    const nodes = [a, b];

    const arranged = layoutSelection(nodes, [], new Set(["a", "b"]));
    const byId = new Map(arranged.map((node) => [node.id, node]));

    // 选中包围盒 0..1144，中心 572；两图一块（宽 304）应居中于 572
    const blockCenter = (center(byId.get("a")!) + center(byId.get("b")!)) / 2;
    expect(Math.abs(blockCenter - 572)).toBeLessThanOrEqual(1);
    expect(byId.get("a")!.position.y).toBe(byId.get("b")!.position.y);
  });

  it("keeps the band centered on the selection center and stays idempotent", () => {
    const a = { ...imageNode("a"), position: { x: 0, y: 0 } } as WorkflowNode;
    const b = { ...imageNode("b"), position: { x: 0, y: 0 } } as WorkflowNode;
    const nodes = [a, b];

    const arranged = layoutSelection(nodes, [], new Set(["a", "b"]));
    const byId = new Map(arranged.map((node) => [node.id, node]));
    const once = { a: byId.get("a")!.position, b: byId.get("b")!.position };

    // 内容宽 304 > 包围盒宽 144：以选中中心为锚对称展开（左 -80 / 右 +80）
    expect(once.a.x).toBe(-80);
    expect(once.b.x).toBe(80);
    expect((center(byId.get("a")!) + center(byId.get("b")!)) / 2).toBe(72);

    // 连续整理幂等：结果与第一次完全一致（不漂移）
    const again = layoutSelection(arranged, [], new Set(["a", "b"]));
    const againById = new Map(again.map((node) => [node.id, node]));
    expect(againById.get("a")!.position).toEqual(once.a);
    expect(againById.get("b")!.position).toEqual(once.b);
  });

  it("anchors groups above their card clusters and images above the groups, and never drifts on repeated layouts", () => {
    // 用户场景：两个图片组各连 10 张卡片，两张图片各连一个组——自底向上定位：
    // 卡片行（左 10 / 右 10）→ 组在各自卡片簇中央上方 → 图片在两个组中央上方
    const makeCard = (id: string, groupId: string, index: number) => ({
      ...promptNode(id),
      position: { x: (groupId === "g1" ? 0 : 4000) + index * 40, y: 600 },
      data: { ...promptNode(id).data, title: groupId + "-" + String(index + 1).padStart(2, "0") },
    }) as WorkflowNode;
    const nodes: WorkflowNode[] = [
      { ...imageNode("a"), position: { x: 0, y: 0 } } as WorkflowNode,
      { ...imageNode("b"), position: { x: 800, y: 0 } } as WorkflowNode,
      { ...groupNode("g1"), position: { x: 400, y: 200 } } as WorkflowNode,
      { ...groupNode("g2"), position: { x: 4400, y: 200 } } as WorkflowNode,
    ];
    const edges: WorkflowEdge[] = [edge("a", "g1"), edge("b", "g2")];
    for (let i = 0; i < 10; i += 1) {
      const p1 = makeCard("p" + i, "g1", i);
      const p2 = makeCard("q" + i, "g2", i);
      nodes.push(p1, p2);
      edges.push(edge("g1", "p" + i), edge("g2", "q" + i));
    }
    const all = new Set(nodes.map((n) => n.id));

    const once = layoutSelection(nodes, edges, all);
    const onceById = new Map(once.map((node) => [node.id, node]));
    const leftCards = once.filter((n) => n.type === "prompt" && String(n.id).startsWith("p"));
    const rightCards = once.filter((n) => n.type === "prompt" && String(n.id).startsWith("q"));
    const leftCenter = leftCards.reduce((s, n) => s + center(n), 0) / leftCards.length;
    const rightCenter = rightCards.reduce((s, n) => s + center(n), 0) / rightCards.length;
    const g1 = onceById.get("g1")!;
    const g2 = onceById.get("g2")!;

    // 组 = 各自卡片簇的中央上方；每张图站在自己的组中央上方（连接结构决定位置）
    expect(Math.abs(center(g1) - leftCenter)).toBeLessThanOrEqual(3);
    expect(Math.abs(center(g2) - rightCenter)).toBeLessThanOrEqual(3);
    expect(Math.abs(center(onceById.get("a")!) - center(g1))).toBeLessThanOrEqual(3);
    expect(Math.abs(center(onceById.get("b")!) - center(g2))).toBeLessThanOrEqual(3);
    // 卡片行内部不混排：组内标题有序（标题组前缀 g1-01..g1-10）
    for (let i = 1; i < leftCards.length; i += 1) {
      expect(leftCards[i - 1].position.x).toBeLessThan(leftCards[i].position.x);
    }
    // 连续整理幂等：第二次结果与第一次完全一致（不漂移）
    const twice = layoutSelection(once, edges, all);
    for (const node of twice) {
      expect(node.position).toEqual(onceById.get(node.id)!.position);
    }
  });

  it("places a shared image exactly between two groups at the top", () => {
    // 一张图同时连两个组：图站在两个组中央上方（对称分叉）
    const shared = { ...imageNode("s"), position: { x: 0, y: 0 } } as WorkflowNode;
    const g1 = { ...groupNode("g1"), position: { x: 100, y: 100 } } as WorkflowNode;
    const g2 = { ...groupNode("g2"), position: { x: 500, y: 100 } } as WorkflowNode;
    const p1 = { ...promptNode("p1"), position: { x: 50, y: 300 } } as WorkflowNode;
    const p2 = { ...promptNode("p2"), position: { x: 550, y: 300 } } as WorkflowNode;
    const nodes = [shared, g1, g2, p1, p2];
    const edges = [edge("s", "g1"), edge("s", "g2"), edge("g1", "p1"), edge("g2", "p2")];

    const arranged = layoutSelection(nodes, edges, new Set(nodes.map((n) => n.id)));
    const byId = new Map(arranged.map((node) => [node.id, node]));

    const gMid = (center(byId.get("g1")!) + center(byId.get("g2")!)) / 2;
    expect(Math.abs(center(byId.get("s")!) - gMid)).toBeLessThanOrEqual(3);
    expect(byId.get("s")!.position.y).toBeLessThan(byId.get("g1")!.position.y);
  });

  it("aligns a selected prompt card to the center of its selection instead of drifting far right", () => {
    // 用户场景：画布左侧放图/组，右侧很远放卡片；选中全部整理后应整体居中
    const g = { ...groupNode("g"), position: { x: 0, y: 200 } } as WorkflowNode;
    const p = { ...promptNode("p"), position: { x: 1600, y: 600 } } as WorkflowNode;
    const img = { ...imageNode("img"), position: { x: 0, y: 0 } } as WorkflowNode;
    const nodes = [g, p, img];
    const edges = [edge("img", "g"), edge("g", "p")];

    const arranged = layoutSelection(nodes, edges, new Set(["g", "p", "img"]));
    const byId = new Map(arranged.map((node) => [node.id, node]));

    // 三条链整体居中：包围盒 0..1900，中心 950；层0 链宽 144（img）
    const mid = 950;
    expect(Math.abs(center(byId.get("img")!) - mid)).toBeLessThanOrEqual(144);
    expect(Math.abs(center(byId.get("g")!) - mid)).toBeLessThanOrEqual(224);
    expect(Math.abs(center(byId.get("p")!) - mid)).toBeLessThanOrEqual(300);
  });
});

describe("layout bipartite mesh", () => {
  it("disperses source images by downstream centroid instead of left-aligning them", () => {
    const a = imageNode("a");
    const b = imageNode("b");
    const c = imageNode("c");
    const g1 = groupNode("g1");
    const g2 = groupNode("g2");
    const nodes = [a, b, c, g1, g2];
    const edges = [edge("a", "g1"), edge("b", "g1"), edge("b", "g2"), edge("c", "g2")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));
    const imgs = ["a", "b", "c"].map((id) => byId.get(id)!);
    const gs = ["g1", "g2"].map((id) => byId.get(id)!);

    // 源图分散（不左对齐成一人堆）：a 左、b 中、c 右；组同样左→右
    expect(imgs[0].position.x).toBeLessThan(imgs[1].position.x);
    expect(imgs[1].position.x).toBeLessThan(imgs[2].position.x);
    expect(gs[0].position.x).toBeLessThan(gs[1].position.x);
    // 同层不重叠
    expect(horizontalGap(imgs[0], imgs[1])).toBeGreaterThanOrEqual(0);
    expect(horizontalGap(imgs[1], imgs[2])).toBeGreaterThanOrEqual(0);
    expect(horizontalGap(gs[0], gs[1])).toBeGreaterThanOrEqual(0);
    // 图在上、组在下
    for (const img of imgs) {
      expect(img.position.y).toBeLessThan(gs[0].position.y);
    }
    // b 站在 g1 与 g2 之间（对称几何中心附近，容差 = 半个组宽 + 余量）
    const mid = (center(gs[0]) + center(gs[1])) / 2;
    expect(Math.abs(center(byId.get("b")!) - mid)).toBeLessThanOrEqual(224);
    // 端源图与对应组中心对齐（容差 = 图宽：对质心对齐的近似等价形式）
    expect(Math.abs(center(byId.get("a")!) - center(gs[0]))).toBeLessThanOrEqual(160);
    expect(Math.abs(center(byId.get("c")!) - center(gs[1]))).toBeLessThanOrEqual(160);
  });

  it("centers multiple groups under their shared source image", () => {
    const a = imageNode("a");
    const g1 = groupNode("g1");
    const g2 = groupNode("g2");
    const nodes = [a, g1, g2];
    const edges = [edge("a", "g1"), edge("a", "g2")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    const blockCenter = (center(byId.get("g1")!) + center(byId.get("g2")!)) / 2;
    expect(Math.abs(center(byId.get("a")!) - blockCenter)).toBeLessThanOrEqual(224);
    expect(byId.get("g1")!.position.y).toBe(byId.get("g2")!.position.y);
  });

  it("centers a group under the centroid of its input images", () => {
    const nodes = [imageNode("a"), imageNode("b"), imageNode("c"), groupNode("g"), promptNode("p")];
    const edges = [edge("a", "g"), edge("b", "g"), edge("c", "g"), edge("g", "p")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    const imgBlockCenter =
      (center(byId.get("a")!) + center(byId.get("b")!) + center(byId.get("c")!)) / 3;
    expect(Math.abs(center(byId.get("g")!) - imgBlockCenter)).toBeLessThanOrEqual(200);
    expect(Math.abs(center(byId.get("p")!) - center(byId.get("g")!))).toBeLessThanOrEqual(3);
  });

  it("orders same-source direct prompt cards by title and keeps them side by side", () => {
    const a = imageNode("a");
    const nodes = [a, withPromptTitle("p-z", "Zeta"), withPromptTitle("p-a", "Alpha")];
    const edges = [edge("a", "p-z"), edge("a", "p-a")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    const pa = byId.get("p-a")!;
    const pz = byId.get("p-z")!;
    expect(pa.position.x).toBeLessThan(pz.position.x);
    expect(pa.position.y).toBe(pz.position.y);
    expect(horizontalGap(pa, pz)).toBeGreaterThanOrEqual(0);
  });

  it("keeps both a direct prompt and a group attached to the same image in the same band", () => {
    const a = imageNode("a");
    const p1 = promptNode("p1");
    const g = groupNode("g");
    const p2 = promptNode("p2");
    const nodes = [a, p1, g, p2];
    const edges = [edge("a", "p1"), edge("a", "g"), edge("g", "p2")];

    const arranged = autoLayout(nodes, edges);
    const byId = new Map(arranged.map((node) => [node.id, node]));

    // 直连卡与组同层（都在 a 下方），组连卡在更下层
    expect(byId.get("p1")!.position.y).toBe(byId.get("g")!.position.y);
    expect(byId.get("p2")!.position.y).toBeGreaterThan(byId.get("g")!.position.y);
    // a 在两个下游之间的质心上方（不偏到任何一侧）
    const mid = (center(byId.get("p1")!) + center(byId.get("g")!)) / 2;
    expect(Math.abs(center(byId.get("a")!) - mid)).toBeLessThanOrEqual(300);
  });
});
