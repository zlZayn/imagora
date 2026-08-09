export type GenerationTaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface GenerationTaskSnapshot {
  id: string;
  status: GenerationTaskStatus;
  error?: string;
}

export interface GenerationRunContext {
  isCancelled: () => boolean;
}

interface QueueOptions {
  concurrency: number;
  run: (id: string, context: GenerationRunContext) => Promise<void>;
}

interface TaskRecord extends GenerationTaskSnapshot {
  token: symbol;
}

export interface GenerationQueue {
  enqueue: (id: string) => boolean;
  cancel: (id: string) => boolean;
  retryFailed: () => number;
  getSnapshot: () => GenerationTaskSnapshot[];
  subscribe: (listener: (tasks: GenerationTaskSnapshot[]) => void) => () => void;
  onIdle: () => Promise<void>;
}

/** 小型内存队列：集中处理去重、并发、失败释放与取消后的结果忽略。 */
export function createGenerationQueue(options: QueueOptions): GenerationQueue {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const tasks = new Map<string, TaskRecord>();
  const pending: string[] = [];
  const listeners = new Set<(tasks: GenerationTaskSnapshot[]) => void>();
  const idleResolvers = new Set<() => void>();
  let active = 0;

  const getSnapshot = () => Array.from(tasks.values(), ({ token: _token, ...task }) => ({ ...task }));

  const emit = () => {
    const snapshot = getSnapshot();
    listeners.forEach((listener) => listener(snapshot));
  };

  const settleIdle = () => {
    if (active || pending.length) return;
    idleResolvers.forEach((resolve) => resolve());
    idleResolvers.clear();
  };

  const pump = () => {
    while (active < concurrency && pending.length) {
      const id = pending.shift()!;
      const task = tasks.get(id);
      if (!task || task.status !== "queued") continue;

      task.status = "running";
      task.error = undefined;
      active += 1;
      emit();
      const token = task.token;

      void Promise.resolve()
        .then(() => options.run(id, {
          isCancelled: () => {
            const current = tasks.get(id);
            return !current || current.token !== token || current.status === "cancelled";
          },
        }))
        .then(() => {
          const current = tasks.get(id);
          if (current?.token === token && current.status === "running") current.status = "done";
        })
        .catch((error: unknown) => {
          const current = tasks.get(id);
          if (!current || current.token !== token || current.status === "cancelled") return;
          current.status = "failed";
          current.error = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          active -= 1;
          emit();
          pump();
          settleIdle();
        });
    }
    settleIdle();
  };

  const enqueue = (id: string) => {
    const current = tasks.get(id);
    if (current?.status === "queued" || current?.status === "running") return false;
    tasks.set(id, { id, status: "queued", token: Symbol(id) });
    pending.push(id);
    emit();
    pump();
    return true;
  };

  const cancel = (id: string) => {
    const task = tasks.get(id);
    if (!task || (task.status !== "queued" && task.status !== "running")) return false;
    task.status = "cancelled";
    const index = pending.indexOf(id);
    if (index >= 0) pending.splice(index, 1);
    emit();
    pump();
    settleIdle();
    return true;
  };

  return {
    enqueue,
    cancel,
    retryFailed: () => {
      const failed = getSnapshot().filter((task) => task.status === "failed");
      failed.forEach((task) => enqueue(task.id));
      return failed.length;
    },
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
    onIdle: () => active || pending.length
      ? new Promise<void>((resolve) => idleResolvers.add(resolve))
      : Promise.resolve(),
  };
}
