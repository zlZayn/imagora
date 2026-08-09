import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { recoveryLatest, recoverySave } from "./api";
import { errMessage } from "./format";
import { buildRecoverySnapshot } from "./recovery";
import type { WorkflowEdge, WorkflowNode } from "./types";
import { workflowToCanvas } from "./workflow";

interface UseCanvasRecoveryOptions {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onRestore: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  onLog: (line: string) => void;
}

/** 自动保存到独立恢复快照，并在挂载时询问是否恢复最近快照。 */
export function useCanvasRecovery({ nodes, edges, onRestore, onLog }: UseCanvasRecoveryOptions) {
  const [ready, setReady] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    let active = true;
    recoveryLatest()
      .then((snapshot) => {
        if (!active || !snapshot.ok || !snapshot.nodes?.length) return;
        const label = snapshot.savedAt ? `（${snapshot.savedAt}）` : "";
        if (!window.confirm(`发现画布恢复存档${label}，是否恢复？`)) return;
        const restored = workflowToCanvas(snapshot.nodes, snapshot.edges ?? [], snapshot.missing ?? []);
        onRestore(restored.nodes, restored.edges);
        onLog("已恢复最近一次画布存档");
      })
      .catch((err) => {
        if (active) onLog(`读取恢复存档失败：${errMessage(err)}`);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [onLog, onRestore]);

  const snapshot = useMemo(() => buildRecoverySnapshot(nodes, edges), [nodes, edges]);
  const snapshotKey = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const saveSnapshot = useCallback(() => {
    void recoverySave(snapshot).catch((err) => {
      if (mountedRef.current) onLog(`自动保存失败：${errMessage(err)}`);
    });
  }, [onLog, snapshot]);

  useEffect(() => {
    if (!ready || !snapshot.nodes.length) return;
    const timer = window.setTimeout(saveSnapshot, 1500);
    return () => window.clearTimeout(timer);
  }, [ready, saveSnapshot, snapshot.nodes.length, snapshotKey]);
}
