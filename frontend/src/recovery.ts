import type { WorkflowEdge, WorkflowNode } from "./types";

export interface RecoverySnapshotPayload {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** 只保存可恢复的画布内容，排除计时、错误和任务状态等运行期字段。 */
export function buildRecoverySnapshot(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): RecoverySnapshotPayload {
  return {
    nodes: nodes.map((node): WorkflowNode => {
      if (node.type !== "prompt") return node;
      const { elapsed: _elapsed, resultCount: _resultCount, message: _message, ...data } = node.data;
      return {
        ...node,
        data: { ...data, quality: data.quality ?? "high", status: "idle" },
      };
    }),
    edges: [...edges],
  };
}
