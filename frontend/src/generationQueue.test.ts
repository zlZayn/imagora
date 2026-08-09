import { describe, expect, it } from "vitest";

import { createGenerationQueue } from "./generationQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("generation queue", () => {
  it("deduplicates queued and running task ids", async () => {
    const gate = deferred();
    const calls: string[] = [];
    const queue = createGenerationQueue({
      concurrency: 2,
      run: async (id) => {
        calls.push(id);
        await gate.promise;
      },
    });

    expect(queue.enqueue("p1")).toBe(true);
    expect(queue.enqueue("p1")).toBe(false);
    gate.resolve();
    await queue.onIdle();

    expect(calls).toEqual(["p1"]);
  });

  it("never exceeds the configured concurrency", async () => {
    const gates = new Map(["a", "b", "c"].map((id) => [id, deferred()]));
    let active = 0;
    let maxActive = 0;
    const queue = createGenerationQueue({
      concurrency: 2,
      run: async (id) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gates.get(id)!.promise;
        active -= 1;
      },
    });

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    await Promise.resolve();
    expect(maxActive).toBe(2);

    gates.get("a")!.resolve();
    await Promise.resolve();
    gates.get("b")!.resolve();
    gates.get("c")!.resolve();
    await queue.onIdle();
    expect(maxActive).toBe(2);
  });

  it("releases failed tasks and retries only failures", async () => {
    const attempts = new Map<string, number>();
    const queue = createGenerationQueue({
      concurrency: 1,
      run: async (id) => {
        const next = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, next);
        if (id === "bad" && next === 1) throw new Error("failed");
      },
    });

    queue.enqueue("ok");
    queue.enqueue("bad");
    await queue.onIdle();
    expect(queue.getSnapshot().find((task) => task.id === "bad")?.status).toBe("failed");

    expect(queue.retryFailed()).toBe(1);
    await queue.onIdle();
    expect(attempts.get("ok")).toBe(1);
    expect(attempts.get("bad")).toBe(2);
  });

  it("keeps a cancelled running task cancelled after its work resolves", async () => {
    const gate = deferred();
    const queue = createGenerationQueue({ concurrency: 1, run: async () => gate.promise });

    queue.enqueue("p1");
    await Promise.resolve();
    expect(queue.cancel("p1")).toBe(true);
    gate.resolve();
    await queue.onIdle();

    expect(queue.getSnapshot().find((task) => task.id === "p1")?.status).toBe("cancelled");
  });

  it("does not let an old cancelled run complete a new run with the same id", async () => {
    const oldGate = deferred();
    const newGate = deferred();
    let call = 0;
    const queue = createGenerationQueue({
      concurrency: 2,
      run: async (_id, context) => {
        const gate = call++ === 0 ? oldGate : newGate;
        await gate.promise;
        if (context.isCancelled()) return;
      },
    });

    queue.enqueue("p1");
    await Promise.resolve();
    queue.cancel("p1");
    queue.enqueue("p1");
    oldGate.resolve();
    newGate.resolve();
    await queue.onIdle();

    expect(queue.getSnapshot().find((task) => task.id === "p1")?.status).toBe("done");
  });
});
