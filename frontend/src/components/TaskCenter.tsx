import type { GenerationTaskSnapshot } from "../types";

const STATUS_LABEL = {
  queued: "排队中",
  running: "生成中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
} as const;

export default function TaskCenter({
  tasks,
  onCancel,
  onRetryFailed,
}: {
  tasks: GenerationTaskSnapshot[];
  onCancel: (id: string) => void;
  onRetryFailed: () => void;
}) {
  if (!tasks.length) return null;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  return (
    <details className="border-y border-neutral-200 bg-white/70 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-neutral-600">
        <span className="font-medium text-neutral-800">任务中心</span>
        <span>排队 {queued}</span>
        <span>运行 {running}</span>
        <span className={failed ? "text-red-600" : ""}>失败 {failed}</span>
        {failed > 0 && (
          <button type="button" className="btn-ghost ml-auto !px-2 !py-0.5 text-xs" onClick={(event) => {
            event.preventDefault();
            onRetryFailed();
          }}>
            重试失败任务
          </button>
        )}
      </summary>
      <div className="mt-2 grid max-h-36 gap-1 overflow-auto border-t border-neutral-100 pt-2">
        {tasks.map((task) => (
          <div key={task.taskId} className="flex min-h-7 items-center gap-3 px-1 text-neutral-500">
            <span className="min-w-0 flex-1 truncate font-mono">{task.taskId}</span>
            <span className={task.status === "failed" ? "text-red-600" : ""}>{STATUS_LABEL[task.status]}</span>
            {(task.status === "queued" || task.status === "running") && (
              <button type="button" className="text-neutral-500 hover:text-red-600" onClick={() => onCancel(task.taskId)}>
                {task.status === "running" ? "忽略结果" : "取消"}
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
