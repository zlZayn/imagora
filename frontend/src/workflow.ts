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

/** 工作流加载结果转画布：按 missing 列表给对应图片节点打标（红框提示文件缺失）；
 *  prompt 节点归一化（重置运行状态为 idle，位置/参数无损保留） */
export function workflowToCanvas(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  missing: string[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const missingSet = new Set(missing);
  const marked = nodes.map((node): WorkflowNode => {
    if (node.type === "image" && missingSet.has(node.data.registryId)) {
      return { ...node, data: { ...node.data, missing: true } };
    }
    if (node.type === "prompt") {
      // 无损：保留位置/提示词/尺寸/质量/输出路径，仅清掉运行期状态
      return {
        ...node,
        data: {
          ...node.data,
          status: "idle" as const,
          elapsed: undefined,
          resultCount: undefined,
          message: undefined,
        },
      };
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

/** 提示词节点的入边图片绝对路径快照（纯函数：运行前锁定参考图集合，画布后续编辑不影响本次运行）。
 *  支持图片组：入边若是 group 节点，递归展开其入边图片（visited 防环）。 */
export function snapshotIncomingAbsPaths(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  promptNodeId: string,
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const paths: string[] = [];
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
      paths.push(node.data.absPath);
    } else if (node.type === "group") {
      // 分组：递归收集其入边（image 或嵌套 group）
      edges.filter((e) => e.target === sid).forEach((e) => stack.push(e.source));
    }
  }
  return paths;
}
