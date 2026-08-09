import { type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Eye, RefreshCw, Trash2 } from "lucide-react";
import type { CanvasGroupNodeData, CanvasImageNodeData, CanvasPromptNodeData } from "../types";
import FolderPicker from "./FolderPicker";
import Select from "./Select";

/* ---------------- 统一节点右上角操作区（hover 显示，全部 nodrag 防误拖） ---------------- */
function NodeActions({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -top-3 right-0 z-30 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {children}
    </div>
  );
}

function ActionButton({
  onClick,
  danger,
  label,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`nodrag btn-ghost !px-1.5 !py-0.5 text-[10px] ${danger ? "text-red-500" : ""}`}
    >
      {children}
    </button>
  );
}

/* ---------------- 图片节点：固定宽度、高度按图片比例自适应 ---------------- */
export type ImageFlowNode = Node<CanvasImageNodeData, "image">;

interface ImageNodeExtraProps {
  /** 替换图片（换一张图，旧文件保留） */
  onReplace: (nodeId: string) => void;
  /** 删除节点（仅移除节点与连线，不删文件） */
  onDelete: (nodeId: string) => void;
  /** 放大预览 */
  onZoom: (nodeId: string) => void;
}

export function ImageNode({
  id,
  data,
  selected,
  onReplace,
  onDelete,
  onZoom,
}: NodeProps<ImageFlowNode> & ImageNodeExtraProps) {
  return (
    <div
      className={`panel-card group relative !p-2 ${data.missing ? "!border-red-400" : ""} ${
        selected ? "node-selected" : ""
      }`}
    >
      {/* 顶部接收提示词产出；底部作为参考图输出。 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!rounded !border-0 !bg-brand/90"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!rounded !border-0 !bg-brand"
      />
      {data.missing && (
        <span className="absolute right-1 top-1 rounded bg-red-500 px-1 py-0.5 text-[10px] font-medium text-white">
          文件缺失
        </span>
      )}
      {/* 图片专用操作区：悬停时在右侧显示，不遮挡图片。 */}
      <div
        data-testid="image-action-rail"
        className="absolute left-full top-2 z-30 ml-2 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <ActionButton label="预览大图" onClick={() => onZoom(id)}>
          <Eye aria-hidden="true" size={14} />
        </ActionButton>
        <ActionButton label="替换图片" onClick={() => onReplace(id)}>
          <RefreshCw aria-hidden="true" size={14} />
        </ActionButton>
        <ActionButton label="删除图片" onClick={() => onDelete(id)} danger>
          <Trash2 aria-hidden="true" size={14} />
        </ActionButton>
      </div>
      {/* 固定展示框避免图片加载后撑高节点，object-contain 保留完整画面。 */}
      <div
        className="h-40 w-32 cursor-zoom-in overflow-hidden rounded bg-neutral-50"
        onDoubleClick={(event) => {
          event.stopPropagation();
          onZoom(id);
        }}
      >
        <img src={data.url} alt={data.name} className="block h-full w-full object-contain" draggable={false} />
      </div>
      <div className="mt-1 max-w-[128px] truncate text-[11px] text-neutral-600" title={data.name}>
        {data.name}
      </div>
      <div className="text-[10px] text-neutral-400">
        {data.refCount > 0 ? `引用 ${data.refCount} 处` : "未引用"}
      </div>
    </div>
  );
}

/* ---------------- 图片组节点：聚合多张图片后统一连到提示词节点 ---------------- */
export type GroupFlowNode = Node<CanvasGroupNodeData, "group">;

interface GroupNodeExtraProps {
  onDelete: (nodeId: string) => void;
}

export function GroupNode({ id, data, selected, onDelete }: NodeProps<GroupFlowNode> & GroupNodeExtraProps) {
  const mb = data.totalSize > 0 ? (data.totalSize / (1024 * 1024)).toFixed(1) : "0.0";
  return (
    <div
      className={`group relative w-56 rounded-lg bg-brand/5 !p-4 ${
        selected ? "ring-2 ring-brand" : ""
      }`}
    >
      {/* 顶部接收图片，底部输出到提示词。 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!rounded !border-0 !bg-brand/90"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!rounded !border-0 !bg-brand"
      />
      <NodeActions>
        <ActionButton onClick={() => onDelete(id)} danger>
          删除
        </ActionButton>
      </NodeActions>
      <div className="py-2 text-center">
        <div className="text-xl font-semibold leading-tight text-brand-dark">
          {data.imageCount} 张图
        </div>
        <div className="mt-1 text-base text-neutral-500">{mb} MB</div>
      </div>
    </div>
  );
}

/* ---------------- 提示词节点 ---------------- */
export type PromptFlowNode = Node<CanvasPromptNodeData, "prompt">;

interface PromptNodeExtraProps {
  /** 节点参数就地更新（上抛给画布 setNodes） */
  onUpdate: (nodeId: string, patch: Partial<CanvasPromptNodeData>) => void;
  /** 运行该节点（独立任务，入边快照参考图） */
  onRun: (nodeId: string) => void;
  /** 删除该节点（连同其连线） */
  onDelete: (nodeId: string) => void;
  /** 尺寸/质量选项（由画布 config 派生传入） */
  sizeOptions: { value: string; label: string }[];
  qualityOptions: { value: string; label: string }[];
}

type PromptNodeProps = NodeProps<PromptFlowNode> & PromptNodeExtraProps;

function StatusBadge({ data }: { data: CanvasPromptNodeData }) {
  switch (data.status) {
    case "queued":
      return (
        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          排队中
        </span>
      );
    case "running":
      return (
        <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          生成中 · {data.elapsed ?? 0}s
        </span>
      );
    case "done":
      return (
        <span className="rounded-md bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
          完成 · {data.resultCount ?? 0} 张
        </span>
      );
    case "failed":
      return (
        <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600" title={data.message}>
          失败
        </span>
      );
    default:
      return (
        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
          就绪
        </span>
      );
  }
}

export function PromptNode({
  id,
  data,
  selected,
  onUpdate,
  onRun,
  onDelete,
  sizeOptions,
  qualityOptions,
}: PromptNodeProps) {
  const running = data.status === "running";
  const queued = data.status === "queued";
  const busy = running || queued;
  return (
    <div className={`panel-card group relative z-30 !min-w-[300px] !p-3 ${selected ? "node-selected" : ""}`}>
      {/* 顶部接收参考图，底部输出生成结果。 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!rounded !border-0 !bg-brand/90"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!rounded !border-0 !bg-brand"
      />
      {/* 右上角统一操作区：状态徽标 + 删除 */}
      <NodeActions>
        <StatusBadge data={data} />
        <ActionButton onClick={() => onDelete(id)} danger>
          删除
        </ActionButton>
      </NodeActions>
      <div className="mb-2 text-xs font-semibold text-neutral-700">提示词生成</div>
      <textarea
        value={data.prompt}
        onChange={(e) => onUpdate(id, { prompt: e.target.value })}
        rows={5}
        placeholder="英文提示词，例如：a red apple on white background"
        className="nodrag field-control resize-y text-xs leading-relaxed"
      />
      <div className="nodrag mt-2 grid grid-cols-[7fr_3fr] gap-2">
        <div>
          <label className="field-label text-[10px]">尺寸</label>
          <Select
            options={sizeOptions}
            value={data.size}
            onChange={(v) => onUpdate(id, { size: v })}
            className="mt-0.5"
          />
        </div>
        <div>
          <label className="field-label text-[10px]">质量</label>
          <Select
            options={qualityOptions}
            value={data.quality}
            onChange={(v) => onUpdate(id, { quality: v })}
            className="mt-0.5"
          />
        </div>
      </div>
      <div className="nodrag mt-2">
        <label className="field-label text-[10px]">输出路径</label>
        <div className="mt-0.5">
          <FolderPicker value={data.outputDir} onChange={(v) => onUpdate(id, { outputDir: v })} />
        </div>
      </div>
      <div className="nodrag mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onRun(id)}
          disabled={busy || !data.prompt.trim()}
          className={`btn-primary flex-1 !py-1 text-xs ${busy ? "btn-busy" : ""}`}
        >
          {running ? "生成中..." : queued ? "排队中..." : "运行"}
        </button>
        {data.message && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-red-500" title={data.message}>
            {data.message}
          </span>
        )}
      </div>
    </div>
  );
}
