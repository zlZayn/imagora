import type { WorkflowEdge, WorkflowNode } from "./types";

/* ---------------- 布局引擎：分层 → 群排序 → 双向 barycenter → 块化放置 ----------------
 * 架构：五阶段纯函数管道（全部不修改入参，边不变）：
 *   0) 裁剪：参与布局的节点 + 未选中的"只读锚点"（固定位置参与对齐，不移动）
 *   1) 分层：最长路径（环回边不计层）+ 类型保底（孤立图/组 0、提示词 1）
 *   2) 排序：群 = 同参考来源（提示词的直接前驱集合）的节点；群内按标题，群间按质心
 *   3) 坐标：forward（浅→深，前驱质心）→ backward（深→浅，无前驱节点随后继质心）→ forward 收敛
 *   4) 输出：只改写移动节点位置，其余（含锚点）原样返回
 * 多对多（图↔组网状）由双向质心摊平；"图片直连卡片"与"图片→组→卡片"共用同一
 * "参考锚点 = 直接前驱" 抽象，无特例分支。 */

/** 各节点类型的估算尺寸（用于对齐计算，无需与实际像素完全一致） */
const NODE_SIZES: Record<WorkflowNode["type"], { width: number; height: number }> = {
  image: { width: 144, height: 220 },
  prompt: { width: 300, height: 320 },
  group: { width: 224, height: 120 },
};

export function nodeSize(node: WorkflowNode): { width: number; height: number } {
  const measured = (node as WorkflowNode & {
    measured?: { width?: number; height?: number };
  }).measured;
  const fallback = NODE_SIZES[node.type];
  return {
    width: Math.max(measured?.width ?? 0, fallback.width),
    height: Math.max(measured?.height ?? 0, fallback.height),
  };
}

/** 布局间距参数 */
const LAYOUT = {
  /** 相邻两层（连线深度）之间的垂直间距 */
  layerGap: 60,
  /** 提示词与结果图之间的水平间距（layoutPromptResults 单用） */
  resultGap: 60,
  /** 同层节点之间的水平间距 */
  nodeGap: 16,
  /** 画布左边距 */
  leftMargin: 60,
  /** 画布上边距 */
  topMargin: 40,
};

/** 孤立节点的类型保底层号：图片/组在最浅层，提示词恒在其下一层（保"图在上、卡在下"直觉） */
const TYPE_LAYER_FLOOR: Record<WorkflowNode["type"], number> = {
  image: 0,
  group: 0,
  prompt: 1,
};

/** 提示词卡片界面标题（顺序键）：data.title，缺省「提示词生成」 */
const DEFAULT_PROMPT_TITLE = "提示词生成";

/** 最长路径分层（纯递归）：返回 nodeId 的层号；环回边（正在访问的节点）返回 -1 不计层 */
function longestPathLayer(
  nodeId: string,
  preds: Map<string, string[]>,
  layer: Map<string, number>,
  visiting: Set<string>,
): number {
  const known = layer.get(nodeId);
  if (known !== undefined) return known;
  if (visiting.has(nodeId)) return -1;
  visiting.add(nodeId);
  let l = 0;
  for (const pred of preds.get(nodeId) ?? []) {
    const pl = longestPathLayer(pred, preds, layer, visiting);
    if (pl >= 0) l = Math.max(l, pl + 1);
  }
  visiting.delete(nodeId);
  layer.set(nodeId, l);
  return l;
}

/** 只整理一个提示词的产出节点：在提示词正下方居中横排，不移动任何无关节点。 */
export function layoutPromptResults(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  promptId: string,
): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const prompt = byId.get(promptId);
  if (prompt?.type !== "prompt") return nodes;
  const seen = new Set<string>();
  const results = edges
    .filter((edge) => edge.source === promptId)
    .map((edge) => byId.get(edge.target))
    .filter((node): node is WorkflowNode => {
      if (node?.type !== "image" || seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
  if (!results.length) return nodes;

  const totalWidth = results.reduce(
    (width, node, index) => width + nodeSize(node).width + (index ? LAYOUT.nodeGap : 0),
    0,
  );
  let x = prompt.position.x + nodeSize(prompt).width / 2 - totalWidth / 2;
  const y = prompt.position.y + nodeSize(prompt).height + LAYOUT.resultGap;
  const positions = new Map<string, { x: number; y: number }>();
  for (const result of results) {
    positions.set(result.id, { x, y });
    x += nodeSize(result).width + LAYOUT.nodeGap;
  }
  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
}

/* ---------------- 分层布局核心（layoutSelection / autoLayout 共用） ---------------- */

/** 提示词的参考来源键：直接前驱 id 排序拼接；非提示词返回 null（不参与群内标题排序） */
function promptSourceKey(node: WorkflowNode, preds: Map<string, string[]>): string | null {
  if (node.type !== "prompt") return null;
  return (preds.get(node.id) ?? []).slice().sort().join("|");
}

/** 布局几何：一次算好的只读中间量（{@link computeLayers} 产出，放置阶段消费） */
interface LayoutGeometry {
  byId: Map<string, WorkflowNode>;
  preds: Map<string, string[]>;
  succs: Map<string, string[]>;
  layerGroups: Map<number, WorkflowNode[]>;
  sortedLayers: number[];
  positions: Map<string, { x: number; y: number }>;
  centerOf: (node: WorkflowNode) => number;
  bandY: Map<number, number>;
}

/** 1) 裁剪/建表 + 最长路径分层 + 锚点层带：算出放置所需的全部只读几何。 */
function computeLayers(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  moves: ReadonlySet<string>,
  origin: { x: number; y: number } | undefined,
  baseY: number,
): LayoutGeometry {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // 入边/出边表（两端都在本次节点集合内的边）
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const p = preds.get(edge.target) ?? [];
    p.push(edge.source);
    preds.set(edge.target, p);
    const s = succs.get(edge.source) ?? [];
    s.push(edge.target);
    succs.set(edge.source, s);
  }

  // 1) 分层：最长路径 + 类型保底
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  for (const node of nodes) {
    const l = Math.max(longestPathLayer(node.id, preds, layer, visiting), TYPE_LAYER_FLOOR[node.type]);
    layer.set(node.id, l);
  }
  const layerGroups = new Map<number, WorkflowNode[]>();
  for (const node of nodes) {
    const list = layerGroups.get(layer.get(node.id) ?? 0) ?? [];
    list.push(node);
    layerGroups.set(layer.get(node.id) ?? 0, list);
  }
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);

  // 只读锚点：坐标平移进布局局部系（origin 模式），位置固定参与对齐
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (!moves.has(node.id)) {
      positions.set(node.id, {
        x: node.position.x - (origin?.x ?? 0),
        y: node.position.y - (origin?.y ?? 0),
      });
    }
  }
  const centerOf = (node: WorkflowNode) => (positions.get(node.id)?.x ?? node.position.x) + nodeSize(node).width / 2;
  // 锚点实际底边参与层带累计：移动节点落在锚点（含视觉偏移）正下方，不与锚点重叠
  const bandY = new Map<number, number>();
  {
    let y = baseY;
    for (const li of sortedLayers) {
      const layerBottom = layerGroups
        .get(li)!
        .reduce((bottom, node) => {
          const fixed = positions.get(node.id);
          if (fixed && !moves.has(node.id)) return Math.max(bottom, fixed.y + nodeSize(node).height);
          return Math.max(bottom, y + nodeSize(node).height);
        }, y);
      bandY.set(li, y);
      y = layerBottom + LAYOUT.layerGap;
    }
  }
  return { byId, preds, succs, layerGroups, sortedLayers, positions, centerOf, bandY };
}

interface LayoutRun {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** 需要输出位置的节点 id（其余为只读锚点） */
  moves: ReadonlySet<string>;
  origin?: { x: number; y: number };
  /** 选中包围盒宽度：仅"无锚点的局部整理"传入——布局后整体中心对齐到该宽度中心（重复整理幂等不漂移） */
  boundsWidth?: number;
}

/** 布局一次：分层 → 逐层放置三趟（forward → backward 层 0 → forward 收敛）。
 *  返回值只改写 moves 内节点的 position；锚点与无关节点原样返回。 */
function runLayout(run: LayoutRun): WorkflowNode[] {
  const { nodes, edges, moves, origin, boundsWidth } = run;
  if (!nodes.length) return nodes;
  const baseX = origin ? 0 : LAYOUT.leftMargin;
  const baseY = origin ? 0 : LAYOUT.topMargin;
  const geo = computeLayers(nodes, edges, moves, origin, baseY);
  const { positions } = geo;

  placeForward(geo, moves, baseX);
  placeBackward(geo, moves, baseX);
  alignBlockCenter(nodes, moves, baseX, boundsWidth, positions);

  return nodes.map((node) => {
    if (!moves.has(node.id)) return node;
    const pos = positions.get(node.id);
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return node;
    return origin
      ? { ...node, position: { x: pos.x + origin.x, y: pos.y + origin.y } }
      : { ...node, position: pos };
  });
}

/** 期望中心：已放置前驱（更浅层或锚点）的中心均值；无前驱 → 左基准 */
function desiredByPreds(node: WorkflowNode, geo: LayoutGeometry, baseX: number): number {
  const { byId, preds, positions, centerOf } = geo;
  const centers = (preds.get(node.id) ?? [])
    .map((pred) => byId.get(pred))
    .filter((pred): pred is WorkflowNode => pred !== undefined && positions.has(pred.id))
    .map((pred) => centerOf(pred));
  return centers.length
    ? centers.reduce((sum, c) => sum + c, 0) / centers.length
    : baseX + nodeSize(node).width / 2;
}
/** 放置一层：排序（群间质心、群内标题）→ 块化（同期望中心且同参考来源的提示词合块）→ 落位 */
function placeLayer(
  layerIndex: number,
  desiredOf: (node: WorkflowNode) => number,
  geo: LayoutGeometry,
  moves: ReadonlySet<string>,
  baseX: number,
): void {
  const { layerGroups, preds, positions, bandY } = geo;
  const movable = layerGroups.get(layerIndex)!.filter((node) => moves.has(node.id));
  if (!movable.length) return;
  const desired = new Map<string, number>();
  for (const node of movable) desired.set(node.id, desiredOf(node));
  const sourceKey = (node: WorkflowNode) => promptSourceKey(node, preds);
  // 排序：期望中心主键；同源提示词组内按标题；其余按原始 x（稳定确定）
  const ordered = [...movable].sort((a, b) => {
    const da = desired.get(a.id)!;
    const db = desired.get(b.id)!;
    if (Math.abs(da - db) >= 0.5) return da - db;
    const ka = sourceKey(a);
    const kb = sourceKey(b);
    if (ka !== null && kb !== null && ka === kb && a.type === "prompt" && b.type === "prompt") {
      const ta: string = a.data.title ?? DEFAULT_PROMPT_TITLE;
      const tb: string = b.data.title ?? DEFAULT_PROMPT_TITLE;
      const byTitle = ta.localeCompare(tb, "zh");
      if (byTitle !== 0) return byTitle;
    }
    return a.position.x - b.position.x;
  });
  // 块化：同期望中心；且块内所有提示词共享同一参考来源（不同来源的提示词不混块）
  const sameSource = (block: WorkflowNode[], node: WorkflowNode) =>
    block.every((m) => sourceKey(m) === null || sourceKey(m) === sourceKey(node));
  // 块间保持标准间距：cursorX 从左侧留一个 nodeGap 起步，避免相邻块紧贴/右推累积
  let cursorX = baseX - LAYOUT.nodeGap;
  let i = 0;
  while (i < ordered.length) {
    const center = desired.get(ordered[i].id)!;
    let j = i;
    while (
      j + 1 < ordered.length &&
      Math.abs(desired.get(ordered[j + 1].id)! - center) < 0.5 &&
      sameSource(ordered.slice(i, j + 1), ordered[j + 1])
    ) {
      j += 1;
    }
    const block = ordered.slice(i, j + 1);
    const blockWidth = block.reduce(
      (width, node, index) => width + nodeSize(node).width + (index ? LAYOUT.nodeGap : 0),
      0,
    );
    const y = bandY.get(layerIndex)!;
    let x = Math.max(cursorX + LAYOUT.nodeGap, center - blockWidth / 2);
    for (const node of block) {
      positions.set(node.id, { x, y });
      x += nodeSize(node).width + LAYOUT.nodeGap;
    }
    cursorX = x - LAYOUT.nodeGap;
    i = j + 1;
  }
}

// 2) pass A（top-down 排序与粗定位）：浅 → 深，按前驱质心——确定群顺序（左卡片组/右卡片组）；
//    也给出叶子层（最深层）的初始排列
function placeForward(geo: LayoutGeometry, moves: ReadonlySet<string>, baseX: number): void {
  for (const li of geo.sortedLayers) placeLayer(li, (node) => desiredByPreds(node, geo, baseX), geo, moves, baseX);
}

// 3) pass B（bottom-up 定位）：深 → 浅，按后继质心——
//    图片组站到其卡片组中央上方、图片站到两个组中央上方（自底向上逐层锚定）；
//    叶子（无后继）保持 pass A 位置（卡片行本身不动，只被上层引用）
function placeBackward(geo: LayoutGeometry, moves: ReadonlySet<string>, baseX: number): void {
  const { sortedLayers, succs, byId, positions, centerOf } = geo;
  for (const li of [...sortedLayers].reverse()) {
    placeLayer(li, (node) => {
      const centers = (succs.get(node.id) ?? [])
        .map((succ) => byId.get(succ))
        .filter((succ): succ is WorkflowNode => succ !== undefined && positions.has(succ.id))
        .map((succ) => centerOf(succ));
      if (centers.length) return centers.reduce((sum, c) => sum + c, 0) / centers.length;
      const keep = positions.get(node.id);
      return keep ? keep.x + nodeSize(node).width / 2 : baseX + nodeSize(node).width / 2;
    }, geo, moves, baseX);
  }
}

// 4) 整体中心对齐（仅无锚点的局部整理）：输出块中心 = 输入选中块中心 → 布局是幂等映射，
//    连续点击整理结果不变（不漂移）；锚点场景不平移（卡片跟随固定参考）
function alignBlockCenter(
  nodes: WorkflowNode[],
  moves: ReadonlySet<string>,
  baseX: number,
  boundsWidth: number | undefined,
  positions: Map<string, { x: number; y: number }>,
): void {
  if (boundsWidth !== undefined) {
    const moved = nodes.filter((node) => moves.has(node.id));
    if (moved.length) {
      const minX = Math.min(...moved.map((node) => positions.get(node.id)!.x));
      const maxX = Math.max(...moved.map((node) => positions.get(node.id)!.x + nodeSize(node).width));
      const dx = baseX + boundsWidth / 2 - (minX + maxX) / 2;
      if (dx !== 0) {
        for (const node of moved) {
          const pos = positions.get(node.id)!;
          positions.set(node.id, { x: pos.x + dx, y: pos.y });
        }
      }
    }
  }
}
/** 分层布局（全画布）：所有节点参与移动。origin 可选：整套布局平移到该坐标。 */
export function autoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  origin?: { x: number; y: number },
): WorkflowNode[] {
  if (!nodes.length) return nodes;
  return runLayout({
    nodes,
    edges,
    moves: new Set(nodes.map((node) => node.id)),
    origin,
  });
}

/** 局部整理：只重排选中的节点；与选中节点相邻的未选中节点作为"只读锚点"
 *  参与对齐（卡片仍对准自己的参考图/组），但位置永不改变。
 *  以选中节点包围盒左上角为原点（origin 平移），未选中节点原样返回，边不变。 */
export function layoutSelection(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  selectedIds: Set<string>,
): WorkflowNode[] {
  if (!selectedIds.size) return nodes;
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (!selected.length) return nodes;
  const boundsEdges = edges.filter((edge) => selectedIds.has(edge.source) || selectedIds.has(edge.target));
  const anchorIds = new Set<string>();
  for (const edge of boundsEdges) {
    if (!selectedIds.has(edge.source)) anchorIds.add(edge.source);
    if (!selectedIds.has(edge.target)) anchorIds.add(edge.target);
  }
  const anchors = nodes.filter((node) => anchorIds.has(node.id));
  const minX = Math.min(...selected.map((node) => node.position.x));
  const maxX = Math.max(...selected.map((node) => node.position.x + nodeSize(node).width));
  const minY = Math.min(...selected.map((node) => node.position.y));
  const arranged = runLayout({
    nodes: [...selected, ...anchors],
    edges: boundsEdges,
    moves: selectedIds,
    origin: { x: minX, y: minY },
    // 有锚点时不平移（卡片跟随固定参考）；无锚点（整体选区）时整体中心对齐保证幂等
    boundsWidth: anchorIds.size === 0 ? Math.max(maxX - minX, 1) : undefined,
  });
  const positioned = new Map(arranged.map((node) => [node.id, node]));
  return nodes.map((node) => positioned.get(node.id) ?? node);
}
