import type { WorkflowEdge, WorkflowNode } from "./types";

/* ---------------- 布局引擎：按连线深度分层（广义三段式） ----------------
 * 层号 = 从任一源点的最长路径长度（入边指向更深层）。普通三段式恰好映射到
 * 参考图 0 / 图片组 1 / 提示词 2 / 结果 3；结果图被复用（连到图片组/别的提示词）或
 * 出现多级链路（提示词→结果→图片组→提示词）时自动向下延伸——连线只朝下，不横穿。
 * 未连线的孤立节点按类型保底（图片/组 0，提示词 1），保持"图在上、卡在下"的直觉。
 * 环（结果图回连自身提示词等）容忍：DFS 回边不计层，仅连线跨层，不死循环。 */

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

/** 分层布局：
 *  按连线深度（最长路径）把节点分到逐层纵带，层内按「前驱中心均值（barycenter）」
 *  排序并块居中放置——结果图天然对齐在提示词正下方、图片组成员对齐在组下方，
 *  复用/多级链路自动往下延伸。origin 可选：整套布局平移到该坐标
 *  （局部整理选中节点时用，选中块原地重排不跳位）。返回带新 position 的节点数组（边不变）。 */
export function autoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  origin?: { x: number; y: number },
): WorkflowNode[] {
  if (!nodes.length) return nodes;
  // 布局基准：origin 存在时（局部整理）以选中块左上角为新原点，内部坐标从 0 起算，
  // 最后整体平移到 origin——避免把画布边距 (60,40) 与 origin 叠加导致每次整理整体右移/下移。
  const baseX = origin ? 0 : LAYOUT.leftMargin;
  const baseY = origin ? 0 : LAYOUT.topMargin;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // 入边表：只收两端都在本次节点集合内的边（局部整理时忽略指向未选中节点的边）
  const preds = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = preds.get(edge.target) ?? [];
    list.push(edge.source);
    preds.set(edge.target, list);
  }
  // 1) 分层：最长路径 + 类型保底（孤立图片/组 0、提示词 1）
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  for (const node of nodes) {
    const l = Math.max(
      longestPathLayer(node.id, preds, layer, visiting),
      TYPE_LAYER_FLOOR[node.type],
    );
    layer.set(node.id, l);
  }
  const layerGroups = new Map<number, WorkflowNode[]>();
  for (const node of nodes) {
    const list = layerGroups.get(layer.get(node.id) ?? 0) ?? [];
    list.push(node);
    layerGroups.set(layer.get(node.id) ?? 0, list);
  }
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);

  // 2) 逐层放置：层内 barycenter 排序 + 同中心块居中，层间按最大高度 + 层距错开
  const positions = new Map<string, { x: number; y: number }>();
  let bandY = baseY;
  const centerOf = (node: WorkflowNode) => (positions.get(node.id)?.x ?? node.position.x) + nodeSize(node).width / 2;

  for (const layerIndex of sortedLayers) {
    const layerNodes = layerGroups.get(layerIndex)!;
    // 期望中心：有已放置前驱（在更浅层）用前驱中心均值；无前驱（层 0 / 环回边）一律左对齐打底——
    // 不用原始坐标，否则 origin 平移模式会双重偏移导致二次整理漂移
    const desired = new Map<string, number>();
    for (const node of layerNodes) {
      const centers = (preds.get(node.id) ?? [])
        .map((pred) => byId.get(pred))
        .filter((pred): pred is WorkflowNode => pred !== undefined && positions.has(pred.id))
        .map((pred) => centerOf(pred));
      desired.set(
        node.id,
        centers.length
          ? centers.reduce((sum, c) => sum + c, 0) / centers.length
          : baseX + nodeSize(node).width / 2,
      );
    }
    // 稳定排序：提示词卡片之间按左上角标题升序（界面标题 data.title，缺省「提示词生成」）；
    // 其余按期望中心升序；同中心按原始 x（结果保持确定性）
    const promptTitle = (node: WorkflowNode) =>
      node.type === "prompt" ? node.data.title ?? "提示词生成" : undefined;
    const ordered = [...layerNodes].sort((a, b) => {
      const ta = promptTitle(a);
      const tb = promptTitle(b);
      if (ta !== undefined && tb !== undefined) {
        const byTitle = ta.localeCompare(tb, "zh");
        if (byTitle !== 0) return byTitle;
      }
      return desired.get(a.id)! - desired.get(b.id)! || a.position.x - b.position.x;
    });
    // 块化放置：连续同期望中心的节点合成一块，块居中于该中心；与左侧已放节点碰撞时右移避让
    let cursorX = baseX;
    let i = 0;
    while (i < ordered.length) {
      const center = desired.get(ordered[i].id)!;
      let j = i;
      while (j + 1 < ordered.length && Math.abs(desired.get(ordered[j + 1].id)! - center) < 0.5) j += 1;
      const block = ordered.slice(i, j + 1);
      const blockWidth = block.reduce(
        (width, node, index) => width + nodeSize(node).width + (index ? LAYOUT.nodeGap : 0),
        0,
      );
      let x = Math.max(cursorX, center - blockWidth / 2);
      for (const node of block) {
        positions.set(node.id, { x, y: bandY });
        x += nodeSize(node).width + LAYOUT.nodeGap;
      }
      cursorX = x - LAYOUT.nodeGap;
      i = j + 1;
    }
    // 下一层纵带：本层最大高度 + 层距（不重叠）
    bandY += layerNodes.reduce((height, node) => Math.max(height, nodeSize(node).height), 0) + LAYOUT.layerGap;
  }

  return nodes.map((node) => {
    const pos = positions.get(node.id);
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      return origin
        ? { ...node, position: { x: pos.x + origin.x, y: pos.y + origin.y } }
        : { ...node, position: pos };
    }
    return node;
  });
}

/** 局部整理：只重排选中的节点，其余节点保持原位。
 *  以选中节点包围盒左上角为原点跑分层布局（origin 平移），
 *  未选中节点原样返回。边不变。 */
export function layoutSelection(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  selectedIds: Set<string>,
): WorkflowNode[] {
  if (!selectedIds.size) return nodes;
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (!selected.length) return nodes;
  const minX = Math.min(...selected.map((node) => node.position.x));
  const minY = Math.min(...selected.map((node) => node.position.y));
  const arranged = autoLayout(selected, edges, { x: minX, y: minY });
  const positioned = new Map(arranged.map((node) => [node.id, node]));
  return nodes.map((node) => positioned.get(node.id) ?? node);
}
