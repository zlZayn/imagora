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

/* ---------------- 自动布局：以提示词为中心的模块化布局 ---------------- */

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
  /** 参考图与提示词之间的水平间距 */
  refGap: 60,
  /** 提示词与结果图之间的水平间距 */
  resultGap: 60,
  /** 同列节点之间的垂直间距 */
  nodeGap: 16,
  /** 不同提示词组之间的垂直间距 */
  groupGap: 60,
  /** 画布左边距 */
  leftMargin: 60,
  /** 画布上边距 */
  topMargin: 40,
  /** 孤立节点列宽 */
  orphanColWidth: 144,
};

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

/** 全局三段式布局：
 *  参考图和图片组在上方，提示词横向排列在中间，生成结果在下方。
 *  origin 可选：把整套布局平移到该坐标（局部整理选中节点时用，选中块原地重排不跳位）。
 *  返回带新 position 的节点数组（边不变）。 */
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
  const promptNodes = nodes
    .filter((node) => node.type === "prompt")
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const groupNodes = nodes
    .filter((node) => node.type === "group")
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const imageNodes = nodes.filter((node) => node.type === "image");
  const promptIds = new Set(promptNodes.map((node) => node.id));
  const groupIds = new Set(groupNodes.map((node) => node.id));
  const resultIds = new Set(
    edges
      .filter((edge) => promptIds.has(edge.source) && byId.get(edge.target)?.type === "image")
      .map((edge) => edge.target),
  );
  const topImages = imageNodes.filter((node) => !resultIds.has(node.id));
  const positions = new Map<string, { x: number; y: number }>();

  const maxHeight = (items: WorkflowNode[]) => items.reduce(
    (height, node) => Math.max(height, nodeSize(node).height),
    0,
  );
  let bandY = baseY;
  const imageY = bandY;
  if (topImages.length) bandY += maxHeight(topImages) + LAYOUT.refGap;
  const groupY = bandY;
  if (groupNodes.length) bandY += maxHeight(groupNodes) + LAYOUT.groupGap;
  const promptY = bandY;
  const promptHeight = maxHeight(promptNodes);
  const resultY = promptY + promptHeight + LAYOUT.resultGap;

  // 中层：提示词保持同一横排，并保留整理前的视觉顺序。
  let promptX = baseX;
  for (const prompt of promptNodes) {
    positions.set(prompt.id, { x: promptX, y: promptY });
    promptX += nodeSize(prompt).width + LAYOUT.groupGap;
  }

  const promptCenter = (promptId: string) => {
    const prompt = byId.get(promptId);
    const position = positions.get(promptId);
    return prompt && position ? position.x + nodeSize(prompt).width / 2 : null;
  };

  // 图片组放在其关联提示词范围的水平中心；无关联组进入上层待整理区。
  const desiredGroups = groupNodes.map((group) => {
    const centers = edges
      .filter((edge) => edge.source === group.id && promptIds.has(edge.target))
      .map((edge) => promptCenter(edge.target))
      .filter((center): center is number => center !== null);
    const center = centers.length
      ? (Math.min(...centers) + Math.max(...centers)) / 2
      : baseX + nodeSize(group).width / 2;
    return { group, desiredX: center - nodeSize(group).width / 2 };
  }).sort((a, b) => a.desiredX - b.desiredX);
  let groupRight = baseX;
  for (const { group, desiredX } of desiredGroups) {
    const x = Math.max(baseX, desiredX, groupRight);
    positions.set(group.id, { x, y: groupY });
    groupRight = x + nodeSize(group).width + LAYOUT.nodeGap;
  }

  interface DesiredPlacement {
    node: WorkflowNode;
    desiredX: number;
  }
  const topPlacements: DesiredPlacement[] = [];
  const claimedTopIds = new Set<string>();
  for (const group of groupNodes) {
    const members = edges
      .filter((edge) => edge.target === group.id && byId.get(edge.source)?.type === "image")
      .map((edge) => byId.get(edge.source)!)
      .filter((node) => !resultIds.has(node.id) && !claimedTopIds.has(node.id));
    const groupPosition = positions.get(group.id);
    if (!groupPosition || !members.length) continue;
    const blockWidth = members.reduce(
      (width, node, index) => width + nodeSize(node).width + (index ? LAYOUT.nodeGap : 0),
      0,
    );
    let x = groupPosition.x + nodeSize(group).width / 2 - blockWidth / 2;
    for (const member of members) {
      topPlacements.push({ node: member, desiredX: x });
      claimedTopIds.add(member.id);
      x += nodeSize(member).width + LAYOUT.nodeGap;
    }
  }
  for (const image of topImages.filter((node) => !claimedTopIds.has(node.id))) {
    const centers = edges
      .filter((edge) => edge.source === image.id && promptIds.has(edge.target))
      .map((edge) => promptCenter(edge.target))
      .filter((center): center is number => center !== null);
    const center = centers.length
      ? (Math.min(...centers) + Math.max(...centers)) / 2
      : promptX + topPlacements.length * LAYOUT.nodeGap;
    topPlacements.push({ node: image, desiredX: center - nodeSize(image).width / 2 });
  }
  topPlacements.sort((a, b) => a.desiredX - b.desiredX);
  let topRight = baseX;
  for (const { node, desiredX } of topPlacements) {
    const x = Math.max(baseX, desiredX, topRight);
    positions.set(node.id, { x, y: imageY });
    topRight = x + nodeSize(node).width + LAYOUT.nodeGap;
  }

  // 下层：结果图以来源提示词为中心横向展开，跨提示词时做水平避让。
  const resultPlacements: DesiredPlacement[] = [];
  const claimedResultIds = new Set<string>();
  for (const prompt of promptNodes) {
    const results = edges
      .filter((edge) => edge.source === prompt.id && byId.get(edge.target)?.type === "image")
      .map((edge) => byId.get(edge.target)!)
      .filter((node) => !claimedResultIds.has(node.id));
    const center = promptCenter(prompt.id);
    if (center === null || !results.length) continue;
    const blockWidth = results.reduce(
      (width, node, index) => width + nodeSize(node).width + (index ? LAYOUT.nodeGap : 0),
      0,
    );
    let x = center - blockWidth / 2;
    for (const result of results) {
      resultPlacements.push({ node: result, desiredX: x });
      claimedResultIds.add(result.id);
      x += nodeSize(result).width + LAYOUT.nodeGap;
    }
  }
  resultPlacements.sort((a, b) => a.desiredX - b.desiredX);
  let resultRight = baseX;
  for (const { node, desiredX } of resultPlacements) {
    const x = Math.max(baseX, desiredX, resultRight);
    positions.set(node.id, { x, y: resultY });
    resultRight = x + nodeSize(node).width + LAYOUT.nodeGap;
  }

  // 防御性兜底：未识别的分组关系仍进入上层，不保留可能重叠的旧坐标。
  let fallbackX = Math.max(topRight, groupRight, promptX) + LAYOUT.nodeGap;
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    const y = groupIds.has(node.id) ? groupY : imageY;
    positions.set(node.id, { x: fallbackX, y });
    fallbackX += nodeSize(node).width + LAYOUT.nodeGap;
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
 *  以选中节点包围盒左上角为原点跑三段式布局（origin 平移），
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
