import { describe, expect, it } from "vitest";

import { createCanvasHistory } from "./canvasHistory";
import type { WorkflowNode } from "./types";

const state = (id: string) => ({
  nodes: [{ id, type: "group", position: { x: 0, y: 0 }, data: { name: id, imageCount: 0, totalSize: 0 } } as WorkflowNode],
  edges: [],
});

describe("canvas history", () => {
  it("undoes and redoes recorded canvas states", () => {
    const history = createCanvasHistory(5);
    history.record(state("a"));
    history.record(state("b"));

    const undone = history.undo(state("c"));
    expect(undone?.nodes[0].id).toBe("b");
    const redone = history.redo(undone!);
    expect(redone?.nodes[0].id).toBe("c");
  });

  it("clears redo after recording a new branch and respects the limit", () => {
    const history = createCanvasHistory(2);
    history.record(state("a"));
    history.record(state("b"));
    history.record(state("c"));
    expect(history.undo(state("d"))?.nodes[0].id).toBe("c");
    history.record(state("new"));
    expect(history.canRedo()).toBe(false);
    expect(history.undo(state("latest"))?.nodes[0].id).toBe("new");
    expect(history.undo(state("new"))?.nodes[0].id).toBe("b");
    expect(history.undo(state("b"))).toBeNull();
  });
});
