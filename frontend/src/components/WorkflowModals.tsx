import type { ReactNode } from "react";

/** 工作流条目（保存/加载弹窗共用） */
export interface WorkflowEntry {
  name: string;
  modified: string;
}

/** 遮罩层基座：点击外部关闭 */
function ModalOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[26rem] max-w-[92vw] rounded-lg bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** 保存工作流弹窗：固定目录 output/workflows/，只填名字，可点已有工作流填充（同名覆盖有确认） */
export function WorkflowSaveModal({
  saveName,
  onSaveNameChange,
  workflows,
  onPickName,
  onConfirm,
  onClose,
}: {
  saveName: string;
  onSaveNameChange: (value: string) => void;
  workflows: WorkflowEntry[];
  onPickName: (name: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <h3 className="mb-3 text-sm font-semibold">保存工作流</h3>
      <input
        value={saveName}
        onChange={(e) => onSaveNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
        }}
        placeholder="输入工作流名字（存到 output/workflows/）"
        autoFocus
        className="field-control mb-3"
      />
      {workflows.length > 0 && (
        <div className="mb-3 max-h-36 overflow-auto rounded-lg border border-neutral-200">
          {workflows.map((w) => (
            <button
              key={w.name}
              type="button"
              onClick={() => onPickName(w.name)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-brand/5 hover:text-brand"
            >
              <span className="truncate">{w.name}</span>
              <span className="shrink-0 text-[10px] text-neutral-400">{w.modified}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary !px-4 !py-1 text-xs"
          disabled={!saveName.trim()}
          onClick={onConfirm}
        >
          保存
        </button>
      </div>
    </ModalOverlay>
  );
}

/** 加载工作流弹窗：列出已保存的工作流选择 */
export function WorkflowLoadModal({
  workflows,
  onLoad,
  onClose,
}: {
  workflows: WorkflowEntry[];
  onLoad: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <h3 className="mb-3 text-sm font-semibold">加载工作流</h3>
      <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
        {workflows.map((w) => (
          <button
            key={w.name}
            type="button"
            onClick={() => onLoad(w.name)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-neutral-700 hover:bg-brand/5 hover:text-brand"
          >
            <span className="truncate">{w.name}</span>
            <span className="shrink-0 text-[10px] text-neutral-400">{w.modified}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={onClose}>
          取消
        </button>
      </div>
    </ModalOverlay>
  );
}

/** 放大预览：点遮罩任意处退出，名字显示在图片下方外部 */
export function ZoomModal({
  imagePath,
  name,
  onClose,
}: {
  imagePath: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <img
        src={`/api/image?path=${encodeURIComponent(imagePath)}`}
        alt="预览"
        className="max-h-[80vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="mt-3 max-w-[80vw] truncate rounded-md bg-black/40 px-3 py-1 text-xs text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </div>
      <div className="mt-1 text-[10px] text-white/50">点击空白处关闭</div>
    </div>
  );
}
