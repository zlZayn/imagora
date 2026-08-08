import type {
  CanvasImageEntry,
  WorkflowEdge,
  WorkflowFile,
  WorkflowNode,
} from "./types";

/** 批量导入图片节点时的错开间距（避免互相重叠） */
const IMAGE_STEP = 260;

/** 生成图片节点可渲染 URL（与 RefItem.url 同约定） */
function imageUrl(absPath: string): string {
  return `/api/image?path=${encodeURIComponent(absPath)}`;
}

/** 从注册表条目构建单个画布图片节点 */
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
      url: imageUrl(entry.absPath),
      size: entry.size,
      ext: entry.ext,
      refCount: 0,
      absPath: entry.absPath,
    },
  };
}

/** 注册表条目批量建节点：按 registryId 去重（同一文件画布上只一个节点） */
export function canvasEntriesToNodes(
  entries: CanvasImageEntry[],
  existing: WorkflowNode[],
): WorkflowNode[] {
  const seen = new Set<string>();
  for (const node of existing) {
    if (node.type === "image") {
      seen.add(node.data.registryId);
    }
  }
  const created: WorkflowNode[] = [];
  const baseX = 40 + existing.length * IMAGE_STEP;
  let n = 0;
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    created.push(buildImageNode(entry, { x: baseX + n * IMAGE_STEP, y: 40 }));
    n += 1;
  }
  return created;
}

/** 工作流加载结果转画布：按 missing 列表给对应图片节点打标（红框提示文件缺失） */
export function workflowToCanvas(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  missing: string[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const missingSet = new Set(missing);
  const marked = nodes.map((node) => {
    if (node.type === "image" && missingSet.has(node.data.registryId)) {
      return { ...node, data: { ...node.data, missing: true } } as WorkflowNode;
    }
    return node;
  });
  return { nodes: marked, edges };
}

/** 画布序列化为工作流文件（version 1，保存/加载共用） */
export function canvasToWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  name: string,
): WorkflowFile {
  return { version: 1, name, nodes, edges };
}

/** 计算各图片节点的引用计数（入边数），返回 registryId -> count */
export function computeRefCounts(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === "image") {
      counts.set(node.data.registryId, 0);
    }
  }
  for (const edge of edges) {
    const source = nodes.find((n) => n.id === edge.source);
    if (source?.type === "image") {
      const current = counts.get(source.data.registryId) ?? 0;
      counts.set(source.data.registryId, current + 1);
    }
  }
  return counts;
}

/** 提示词节点的入边图片绝对路径快照（纯函数：运行前锁定参考图集合，画布后续编辑不影响本次运行） */
export function snapshotIncomingAbsPaths(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  promptNodeId: string,
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((e) => e.target === promptNodeId)
    .map((e) => byId.get(e.source))
    .filter((n): n is Extract<WorkflowNode, { type: "image" }> => n?.type === "image")
    .map((n) => n.data.absPath);
}
