import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CanvasImageNodeData, CanvasPromptNodeData } from "../types";
import FolderPicker from "./FolderPicker";
import Select from "./Select";

/** 画布图片节点（仅 source 锚点：作为提示词节点的参考图输入） */
export type ImageFlowNode = Node<CanvasImageNodeData, "image">;

export function ImageNode({ data, selected }: NodeProps<ImageFlowNode>) {
  return (
    <div
      className={`panel-card relative !p-2 ${
        data.missing ? "!border-red-400" : ""
      } ${selected ? "node-selected" : ""}`}
    >
      {/* source 锚点：只允许图片 -> 提示词 */}
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-brand" />
      {data.missing && (
        <span className="absolute right-1 top-1 rounded bg-red-500 px-1 py-0.5 text-[10px] font-medium text-white">
          文件缺失
        </span>
      )}
      <img
        src={data.url}
        alt={data.name}
        className="img-reveal h-24 w-24 rounded object-cover"
        draggable={false}
      />
      <div className="mt-1 max-w-[120px] truncate text-[11px] text-neutral-600" title={data.name}>
        {data.name}
      </div>
      <div className="text-[10px] text-neutral-400">
        {data.refCount > 0 ? `引用 ${data.refCount} 张图` : "未引用"}
      </div>
    </div>
  );
}

/** 画布提示词节点（仅 target 锚点：接收图片作为参考图；独立任务可运行） */
export type PromptFlowNode = Node<CanvasPromptNodeData, "prompt">;

interface PromptNodeExtraProps {
  /** 节点参数就地更新（上抛给画布 setNodes） */
  onUpdate: (nodeId: string, patch: Partial<CanvasPromptNodeData>) => void;
  /** 运行该节点（独立任务，入边快照参考图） */
  onRun: (nodeId: string) => void;
  /** 尺寸/质量选项（由画布 config 派生传入） */
  sizeOptions: { value: string; label: string }[];
  qualityOptions: { value: string; label: string }[];
}

type PromptNodeProps = NodeProps<PromptFlowNode> & PromptNodeExtraProps;

function StatusBadge({ data }: { data: CanvasPromptNodeData }) {
  switch (data.status) {
    case "running":
      return (
        <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          生成中 {data.elapsed ?? 0}s
        </span>
      );
    case "done":
      return (
        <span className="rounded-md bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
          完成 {data.resultCount ?? 0} 张
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
  sizeOptions,
  qualityOptions,
}: PromptNodeProps) {
  const running = data.status === "running";
  return (
    <div className={`panel-card relative z-30 !min-w-[280px] !p-3 ${selected ? "node-selected" : ""}`}>
      {/* target 锚点：接收图片节点连入 */}
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-neutral-400" />
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-700">提示词生成</span>
        <StatusBadge data={data} />
      </div>
      <textarea
        value={data.prompt}
        onChange={(e) => onUpdate(id, { prompt: e.target.value })}
        rows={2}
        placeholder="英文提示词，例如：a red apple on white background"
        className="field-control resize-y text-xs"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
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
      <div className="mt-2">
        <label className="field-label text-[10px]">输出路径</label>
        <div className="mt-0.5">
          <FolderPicker value={data.outputDir} onChange={(v) => onUpdate(id, { outputDir: v })} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onRun(id)}
          disabled={running || !data.prompt.trim()}
          className={`btn-primary flex-1 !py-1 text-xs ${running ? "btn-busy" : ""}`}
        >
          {running ? "生成中..." : "运行"}
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
