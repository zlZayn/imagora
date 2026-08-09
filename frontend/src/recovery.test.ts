import { describe, expect, it } from "vitest";

import type { WorkflowNode } from "./types";
import { buildRecoverySnapshot } from "./recovery";

function runningPrompt(elapsed: number): WorkflowNode {
  return {
    id: "p1",
    type: "prompt",
    position: { x: 20, y: 30 },
    data: {
      prompt: "product photo",
      size: "1024x1024",
      quality: "high",
      outputDir: "output",
      status: "running",
      elapsed,
      resultCount: 2,
      message: "temporary",
    },
  } as WorkflowNode;
}

describe("recovery snapshots", () => {
  it("removes runtime-only prompt state without mutating canvas nodes", () => {
    const source = runningPrompt(5);
    const snapshot = buildRecoverySnapshot([source], []);
    const saved = snapshot.nodes[0];

    expect(saved.type === "prompt" && saved.data).toMatchObject({ status: "idle", quality: "high" });
    expect(saved.type === "prompt" && saved.data.elapsed).toBeUndefined();
    expect(saved.type === "prompt" && saved.data.resultCount).toBeUndefined();
    expect(saved.type === "prompt" && saved.data.message).toBeUndefined();
    expect(source.type === "prompt" && source.data.status).toBe("running");
  });

  it("produces the same snapshot while only elapsed time changes", () => {
    const first = buildRecoverySnapshot([runningPrompt(1)], []);
    const second = buildRecoverySnapshot([runningPrompt(9)], []);

    expect(second).toEqual(first);
  });
});
