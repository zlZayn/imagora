import { type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Eye, RefreshCw, Trash2 } from "lucide-react";
import type { CanvasGroupNodeData, CanvasImageNodeData, CanvasPromptNodeData } from "../types";
import { generatingLabel } from "../format";
import FolderPicker from "./FolderPicker";
import Select from "./Select";

/* ---------------- 统一节点右侧操作区（hover 显示，竖排不遮挡内容，全部 nodrag 防误拖） ---------------- */
function NodeActions({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="absolute left-full top-2 z-30 ml-2 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100"
    >
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
      className={`panel-card group relative !p-2 node-pop ${data.missing ? "!border-red-400" : ""} ${
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
        <span className="absolute right-1 top-1 z-20 rounded bg-red-500 px-1 py-0.5 text-[10px] font-medium text-white">
          文件缺失
        </span>
      )}
      {/* 图片专用操作区：悬停时在右侧显示，不遮挡图片。 */}
      <NodeActions testId="image-action-rail">
        <ActionButton label="预览大图" onClick={() => onZoom(id)}>
          <Eye aria-hidden="true" size={14} />
        </ActionButton>
        <ActionButton label="替换图片" onClick={() => onReplace(id)}>
          <RefreshCw aria-hidden="true" size={14} />
        </ActionButton>
        <ActionButton label="删除图片" onClick={() => onDelete(id)} danger>
          <Trash2 aria-hidden="true" size={14} />
        </ActionButton>
      </NodeActions>
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
      <div className={`text-[10px] ${data.refCount > 0 ? "text-brand" : "text-neutral-400"}`}>
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
      className={`group relative w-56 rounded-lg bg-brand/5 !p-4 node-pop ${
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
        <ActionButton label="删除图片组" onClick={() => onDelete(id)} danger>
          <Trash2 aria-hidden="true" size={14} />
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

/* 状态指示灯：圆点颜色映射状态，悬停 title 看详情（秒数 / 张数 / 失败原因）。
 * 就绪灰、排队琥珀、生成中品牌色呼吸、完成绿、失败红。 */
function StatusLight({ data }: { data: CanvasPromptNodeData }) {
  let color = "bg-neutral-300";
  let pulse = "";
  let title = "就绪";
  switch (data.status) {
    case "queued":
      color = "bg-amber-400";
      title = "排队中";
      break;
    case "running":
      color = "bg-brand";
      pulse = "animate-pulse";
      title = generatingLabel(data.elapsed ?? 0);
      break;
    case "done":
      color = "bg-green-500";
      title = `完成 · ${data.resultCount ?? 0} 张`;
      break;
    case "failed":
      color = "bg-red-500";
      title = data.message ? `失败：${data.message}` : "失败";
      break;
  }
  return (
    <span className="flex justify-center py-0.5" title={title}>
      <span className={`h-2.5 w-2.5 rounded-full ${color} ${pulse}`} />
    </span>
  );
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
    <div className={`panel-card group relative !min-w-[300px] !p-3 node-pop ${selected ? "node-selected" : ""}`}>
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
      {/* 右侧统一操作区：状态灯 + 删除 */}
      <NodeActions>
        <StatusLight data={data} />
        <ActionButton label="删除" onClick={() => onDelete(id)} danger>
          <Trash2 aria-hidden="true" size={14} />
        </ActionButton>
      </NodeActions>
      <div className="mb-2 text-xs font-semibold text-brand-dark">提示词生成</div>
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
          {running ? generatingLabel(data.elapsed ?? 0) : queued ? "排队中..." : "运行"}
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
