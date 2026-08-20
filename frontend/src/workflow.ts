import type {
  CanvasImageEntry,
  CanvasPromptNodeData,
  WorkflowEdge,
  WorkflowNode,
} from "./types";

/** 批量导入图片节点时的错开间距（避免互相重叠） */
const IMAGE_STEP = 260;

/* ---------------- 文件识别：拖拽/粘贴/选择共用同一判定，保证各入口行为一致 ---------------- */

/** 常见图片扩展名（MIME 缺失时兜底识别；与后端 core/canvas.py IMAGE_EXTENSIONS 对齐） */
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

/** 判断 File 是否为图片：优先按 MIME（image/*），MIME 缺失（部分系统拖拽/粘贴不给类型）时按扩展名兜底。
 *  拖拽进来的非图片文件（如 .txt）在此被过滤，只把图片交给上传接口。 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT_RE.test(file.name);
}

/* ---------------- 新建节点落点：视口中心 + 连续创建阶梯错开 ----------------
 * 纯函数：与上次落点相近（视口基本没动）时每次 +CREATE_STAGGER_STEP，
 * 否则回到视口中心。不依赖节点总数——节点一多按总数取模偏移会越偏越远（历史 bug）。 */
export const CREATE_STAGGER_STEP = 30;
/** 与上次落点相距多少以内视为"连续创建"（视口没怎么动） */
export const CREATE_STAGGER_RADIUS = 200;

export function staggerCreatePosition(
  center: { x: number; y: number },
  last: { x: number; y: number } | null,
): { position: { x: number; y: number }; next: { x: number; y: number } } {
  if (
    last &&
    Math.abs(last.x - center.x) < CREATE_STAGGER_RADIUS &&
    Math.abs(last.y - center.y) < CREATE_STAGGER_RADIUS
  ) {
    const next = { x: last.x + CREATE_STAGGER_STEP, y: last.y + CREATE_STAGGER_STEP };
    return { position: next, next };
  }
  return { position: center, next: center };
}

/* ---------------- 运行期动画类：节点 className 上的视觉标记，不持久化 ---------------- */

/** 动画类正则：node-enter / node-exiting / enter-delay-1..3 */
const ANIM_CLASS_RE = /^(?:node-enter|node-exiting|enter-delay-[1-3])$/;

/** 剥离 className 中的全部动画类（加载工作流时清理运行时标记） */
export function stripAnimClasses(className?: string): string | undefined {
  if (!className) return undefined;
  const cleaned = className.split(/\s+/).filter((c) => c && !ANIM_CLASS_RE.test(c));
  return cleaned.length ? cleaned.join(" ") : undefined;
}

/** 只提取 className 中的动画类（高亮类合并时保留动画标记） */
export function extractAnimClasses(className?: string): string {
  if (!className) return "";
  return className.split(/\s+/).filter((c) => c && ANIM_CLASS_RE.test(c)).join(" ");
}

/** 给节点 className 追加交错入场动画类（按 index 循环 enter-delay-1..3，不覆盖已有类） */
export function withEnterAnim(node: WorkflowNode, index: number): WorkflowNode {
  const anim = `node-enter enter-delay-${(index % 3) + 1}`;
  const cls = [node.className, anim].filter(Boolean).join(" ");
  return { ...node, className: cls };
}

/** 从注册表条目构建单个画布图片节点（url 由后端统一提供，与 node.data.url 同约定） */
export function buildImageNode(
  entry: CanvasImageEntry,
  position: { x: number; y: number },
): WorkflowNode {
  return {
    id: `img-${entry.id}`,
    type: "image",
    position,
    data: {
      registryId: entry.id,
      name: entry.name,
      url: entry.url,
      size: entry.size,
      ext: entry.ext,
      refCount: 0,
      absPath: entry.absPath,
    },
  };
}

/** 从参数构建单个提示词节点（点击居中新建 / 工具栏拖放新建共用同一构建，默认参数由调用方提供） */
export function buildPromptNode(
  position: { x: number; y: number },
  params: { size: string; quality: string; outputDir: string },
): WorkflowNode {
  return {
    id: `prompt-${Date.now()}`,
    type: "prompt",
    position,
    data: {
      prompt: "",
      size: params.size,
      quality: params.quality,
      outputDir: params.outputDir,
      status: "idle" as const,
    },
  };
}

/** 从参数构建单个图片组节点（点击居中新建 / 工具栏拖放新建共用同一构建） */
export function buildGroupNode(position: { x: number; y: number }): WorkflowNode {
  return {
    id: `group-${Date.now()}`,
    type: "group",
    position,
    data: { name: "图片组", imageCount: 0, totalSize: 0 },
  };
}

/** 注册表条目批量建节点：按 registryId 去重（同一文件画布上只一个节点）。
 *  origin 可选：本批节点以该坐标（画布视口中心）为起点，缺省回退画布左上角 (40,40)；
 *  批次内按 IMAGE_STEP 横向排开。origin 由调用方负责错开（getCreatePosition 记忆阶梯），
 *  这里不再按节点数叠加偏移，避免"上传/新建越偏越远"的漂移。 */
export function canvasEntriesToNodes(
  entries: CanvasImageEntry[],
  existing: WorkflowNode[],
  origin?: { x: number; y: number },
): WorkflowNode[] {
  const seen = new Set<string>();
  for (const node of existing) {
    if (node.type === "image") {
      seen.add(node.data.registryId);
    }
  }
  const created: WorkflowNode[] = [];
  const baseX = origin?.x ?? 40;
  const baseY = origin?.y ?? 40;
  let n = 0;
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    created.push(buildImageNode(entry, { x: baseX + n * IMAGE_STEP, y: baseY }));
    n += 1;
  }
  return created;
}

/** 工作流加载结果转画布：按 missing 列表给对应图片节点打标（红框提示文件缺失）；
 *  prompt 节点归一化（重置运行状态为 idle，位置/参数无损保留） */
export function workflowToCanvas(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  missing: string[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const missingSet = new Set(missing);
  const marked = nodes.map((node) => {
    const base = { ...node, className: stripAnimClasses(node.className) };
    if (base.type === "image" && missingSet.has(base.data.registryId)) {
      return { ...base, data: { ...base.data, missing: true } };
    }
    if (base.type === "prompt") {
      // 无损：保留位置/提示词/尺寸/质量/输出路径，仅清掉运行期状态
      return {
        ...base,
        data: {
          ...base.data,
          quality: base.data.quality ?? "high",
          status: "idle" as const,
          elapsed: undefined,
          resultCount: undefined,
          message: undefined,
        },
      };
    }
    return base;
  });
  return { nodes: marked, edges };
}

/** 更新单个提示词节点的 data（纯函数：不匹配/非提示词节点原样返回，避免无谓新引用） */
export function updatePromptNode(
  nodes: WorkflowNode[],
  nodeId: string,
  patch: Partial<CanvasPromptNodeData>,
): WorkflowNode[] {
  return nodes.map((n) =>
    n.id === nodeId && n.type === "prompt" ? { ...n, data: { ...n.data, ...patch } } : n,
  );
}

/** 批量更新选区内提示词节点的输出目录；其他节点类型与未选中节点保持原引用。 */
export function updateSelectedPromptOutputDirs(
  nodes: WorkflowNode[],
  selectedIds: ReadonlySet<string>,
  outputDir: string,
): { nodes: WorkflowNode[]; changedCount: number } {
  let changedCount = 0;
  const next = nodes.map((node) => {
    if (node.type !== "prompt" || !selectedIds.has(node.id) || node.data.outputDir === outputDir) {
      return node;
    }
    changedCount += 1;
    return { ...node, data: { ...node.data, outputDir } };
  });
  return { nodes: changedCount ? next : nodes, changedCount };
}

/** 计算各图片节点的引用计数与分组节点成员数/总大小，
 *  返回 registryId -> refCount、groupId -> 成员数、groupId -> 总字节 */
export function computeCounts(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): {
  refCounts: Map<string, number>;
  groupCounts: Map<string, number>;
  groupSizes: Map<string, number>;
} {
  const refCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  const groupSizes = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === "image") {
      refCounts.set(node.data.registryId, 0);
    }
    if (node.type === "group") {
      groupCounts.set(node.id, 0);
      groupSizes.set(node.id, 0);
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source?.type !== "image") continue;
    // 图片被引用（连提示词或分组都算引用）
    refCounts.set(source.data.registryId, (refCounts.get(source.data.registryId) ?? 0) + 1);
    if (target?.type === "group") {
      groupCounts.set(edge.target, (groupCounts.get(edge.target) ?? 0) + 1);
      groupSizes.set(edge.target, (groupSizes.get(edge.target) ?? 0) + (source.data.size ?? 0));
    }
  }
  return { refCounts, groupCounts, groupSizes };
}

/** 收集提示词节点入边的图片节点（纯函数：图片组递归展开，visited 防环）。
 *  运行前锁定参考图集合，画布后续编辑不影响本次运行。 */
export function collectIncomingImages(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  promptNodeId: string,
): WorkflowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const images: WorkflowNode[] = [];
  const visited = new Set<string>([promptNodeId]);
  const stack: string[] = edges
    .filter((e) => e.target === promptNodeId)
    .map((e) => e.source);
  while (stack.length) {
    const sid = stack.pop()!;
    if (visited.has(sid)) continue;
    visited.add(sid);
    const node = byId.get(sid);
    if (!node) continue;
    if (node.type === "image") {
      images.push(node);
    } else if (node.type === "group") {
      // 分组：递归收集其入边（image 或嵌套 group）
      edges.filter((e) => e.target === sid).forEach((e) => stack.push(e.source));
    }
  }
  return images;
}

/** 提示词节点的入边图片绝对路径快照（纯函数：运行前锁定参考图集合，画布后续编辑不影响本次运行）。
 *  缺失（无 absPath）的图片自动跳过——是否缺失由 collectIncomingImages 另行判定。 */
export function snapshotIncomingAbsPaths(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  promptNodeId: string,
): string[] {
  return collectIncomingImages(nodes, edges, promptNodeId)
    .map((n) => (n.type === "image" ? n.data.absPath : undefined))
    .filter((p): p is string => Boolean(p));
}

/** 自动补齐明显的连线：只处理孤立节点，已有连线保持不动。 */
export function autoConnect(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowEdge[] {
  const prompts = nodes.filter((node) => node.type === "prompt");
  const groups = nodes.filter((node) => node.type === "group");
  if (!prompts.length && !groups.length) return edges;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  const next = [...edges];
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const pairs = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));
  const distance = (a: WorkflowNode, b: WorkflowNode) => {
    const dx = a.position.x - b.position.x;
    const dy = a.position.y - b.position.y;
    return dx * dx + dy * dy;
  };
  const nearest = (node: WorkflowNode, candidates: WorkflowNode[]) =>
    candidates.reduce<WorkflowNode | null>((closest, candidate) => (
      !closest || distance(node, candidate) < distance(node, closest) ? candidate : closest
    ), null);
  const add = (source: WorkflowNode, target: WorkflowNode) => {
    const id = `${source.id}->${target.id}`;
    if (pairs.has(id)) return;
    next.push({ id, source: source.id, target: target.id });
    pairs.add(id);
    connected.add(source.id);
  };

  // 图片优先归入就近的图片组（否则直接连提示词）。
  for (const image of nodes.filter((node) => node.type === "image" && !connected.has(node.id))) {
    const prompt = nearest(image, prompts);
    if (prompt && image.position.y > prompt.position.y) {
      add(prompt, image);
      continue;
    }
    const nearbyGroup = nearest(image, groups.filter((group) => group.position.y >= image.position.y));
    if (nearbyGroup && (!prompt || distance(image, nearbyGroup) < distance(image, prompt))) {
      add(image, nearbyGroup);
    } else if (prompt) {
      add(image, prompt);
    }
  }
  // 最后把仍孤立的图片组连接到最近的提示词。
  for (const group of groups) {
    const hasPromptConnection = next.some(
      (edge) => edge.source === group.id && promptIds.has(edge.target),
    );
    if (!hasPromptConnection) {
      const prompt = nearest(group, prompts);
      if (prompt) add(group, prompt);
    }
  }
  // 已有图片组可以复用：每张新提示词卡片都应获得一个参考来源。
  const populatedGroups = groups.filter((group) => next.some(
    (edge) => edge.target === group.id && nodeById.get(edge.source)?.type === "image",
  ));
  const referenceGroups = populatedGroups.length ? populatedGroups : groups;
  for (const prompt of prompts) {
    const hasReference = next.some((edge) => {
      const sourceType = nodeById.get(edge.source)?.type;
      return edge.target === prompt.id && (sourceType === "image" || sourceType === "group");
    });
    if (hasReference) continue;
    const group = nearest(prompt, referenceGroups);
    if (group) add(group, prompt);
  }
  return next;
}

/* ---------------- 自动布局：按连线深度分层（广义三段式） ----------------
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
    // 稳定排序：期望中心升序，同中心按原始 x（结果保持确定性）
    const ordered = [...layerNodes].sort(
      (a, b) => desired.get(a.id)! - desired.get(b.id)! || a.position.x - b.position.x,
    );
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

/** 把一次提交图快照合并进现有画布（Phase B 统一导入，纯函数不改入参）。
 *  图片节点按 registryId 去重复用现有节点；提示词/图片组节点用提交命名空间 id 追加；
 *  边按实际落点映射。落点压在现有内容下方，横向排开。 */
export function mergeSubmissionGraph(
  subNodes: WorkflowNode[],
  subEdges: WorkflowEdge[],
  existing: WorkflowNode[],
  existingEdges: WorkflowEdge[],
  submissionId: string,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const idMap = new Map<string, string>();
  const seenRegistry = new Set<string>();
  const added: WorkflowNode[] = [];
  for (const n of existing) {
    if (n.type === "image") seenRegistry.add(n.data.registryId);
  }
  const maxY = existing.reduce((m, n) => Math.max(m, n.position.y), 0);
  const baseX = existing.length ? existing.reduce((m, n) => Math.min(m, n.position.x), 0) : 0;
  let col = 0;
  for (const n of subNodes) {
    if (n.type === "image") {
      const rid = n.data.registryId;
      const reused = existing.find((x) => x.type === "image" && x.data.registryId === rid);
      if (reused) {
        idMap.set(n.id, reused.id);
        continue;
      }
      if (seenRegistry.has(rid)) continue;
      seenRegistry.add(rid);
      const newId = `img-${rid}`;
      idMap.set(n.id, newId);
      added.push({ ...n, id: newId, position: { x: baseX + col * 40, y: maxY + 80 } });
      col += 1;
    } else {
      const newId = `${n.id}-import-${submissionId}`;
      idMap.set(n.id, newId);
      added.push({ ...n, id: newId, position: { x: baseX + col * 40, y: maxY + 80 } });
      col += 1;
    }
  }
  const edges: WorkflowEdge[] = [];
  for (const e of subEdges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target) continue;
    edges.push({ ...e, id: `${source}->${target}`, source, target });
  }
  return { nodes: [...existing, ...added], edges: [...existingEdges, ...edges] };
}
