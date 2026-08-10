import type { WorkflowEdge, WorkflowNode } from "./types";

export interface CanvasHistoryState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function copyState(state: CanvasHistoryState): CanvasHistoryState {
  return { nodes: [...state.nodes], edges: [...state.edges] };
}

/** 保存用户操作前的画布快照；运行状态更新不应调用 record。 */
export function createCanvasHistory(limit = 50) {
  const maxEntries = Math.max(1, Math.floor(limit));
  const past: CanvasHistoryState[] = [];
  const future: CanvasHistoryState[] = [];

  return {
    record(state: CanvasHistoryState) {
      past.push(copyState(state));
      if (past.length > maxEntries) past.splice(0, past.length - maxEntries);
      future.length = 0;
    },
    undo(current: CanvasHistoryState): CanvasHistoryState | null {
      const previous = past.pop();
      if (!previous) return null;
      future.unshift(copyState(current));
      return copyState(previous);
    },
    restore(current: CanvasHistoryState): CanvasHistoryState | null {
      const next = future.shift();
      if (!next) return null;
      past.push(copyState(current));
      return copyState(next);
    },
    canUndo: () => past.length > 0,
    canRestore: () => future.length > 0,
    clear() {
      past.length = 0;
      future.length = 0;
    },
  };
}
