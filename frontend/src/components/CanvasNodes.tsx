import { useState, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
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
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
  /** 以该图片为参考新建提示词卡片并自动连线 */
  onCreatePromptFromImage: (nodeId: string) => void;
}

export function ImageNode({
  id,
  data,
  selected,
  onReplace,
  onDelete,
  onZoom,
  onCreatePromptFromImage,
}: NodeProps<ImageFlowNode> & ImageNodeExtraProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={`panel-card group relative !p-2 ${data.missing ? "!border-red-400" : ""} ${
        selected ? "node-selected" : ""
      }`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setMenuOpen((v) => !v);
      }}
    >
      {/* source 锚点：只允许图片 -> 提示词 / 图片组 */}
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-brand" />
      {data.missing && (
        <span className="absolute right-1 top-1 rounded bg-red-500 px-1 py-0.5 text-[10px] font-medium text-white">
          文件缺失
        </span>
      )}
      {/* 右上角统一操作区 */}
      <NodeActions>
        <ActionButton onClick={() => onZoom(id)}>放大</ActionButton>
        <ActionButton onClick={() => onReplace(id)}>替换</ActionButton>
        <ActionButton onClick={() => onDelete(id)} danger>
          删除
        </ActionButton>
      </NodeActions>
      {/* 固定宽度 w-32，高度随图片比例自动（不裁切）；不加入场动画类，避免节点重渲染时闪烁 */}
      <div className="w-32 overflow-hidden rounded">
        <img src={data.url} alt={data.name} className="block h-auto w-full" draggable={false} />
      </div>
      <div className="mt-1 max-w-[128px] truncate text-[11px] text-neutral-600" title={data.name}>
        {data.name}
      </div>
      <div className="text-[10px] text-neutral-400">
        {data.refCount > 0 ? `引用 ${data.refCount} 处` : "未引用"}
      </div>
      {/* 双击菜单：放大 / 生成提示词卡片 */}
      {menuOpen && (
        <div className="absolute left-0 top-full z-40 mt-1 w-40 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            className="nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-brand/5 hover:text-brand"
            onClick={() => {
              onZoom(id);
              setMenuOpen(false);
            }}
          >
            放大预览
          </button>
          <button
            type="button"
            className="nodrag flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-brand/5 hover:text-brand"
            onClick={() => {
              onCreatePromptFromImage(id);
              setMenuOpen(false);
            }}
          >
            生成提示词卡片
          </button>
        </div>
      )}
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
      className={`group relative w-32 rounded-lg border-2 border-dashed border-brand/40 bg-brand/5 !p-2 ${
        selected ? "node-selected" : ""
      }`}
    >
      {/* 输入：接收图片节点连入；输出：连到提示词节点 */}
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-neutral-400" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-brand" />
      <NodeActions>
        <ActionButton onClick={() => onDelete(id)} danger>
          删除
        </ActionButton>
      </NodeActions>
      <div className="py-1 text-center">
        <div className="text-sm font-semibold text-brand-dark">
          {data.imageCount} 张图
        </div>
        <div className="text-[10px] text-neutral-500">{mb} MB</div>
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
  onDelete,
  sizeOptions,
  qualityOptions,
}: PromptNodeProps) {
  const running = data.status === "running";
  return (
    <div className={`panel-card group relative z-30 !min-w-[280px] !p-3 ${selected ? "node-selected" : ""}`}>
      {/* target 锚点：接收图片 / 图片组连入 */}
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-neutral-400" />
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
        rows={2}
        placeholder="英文提示词，例如：a red apple on white background"
        className="nodrag field-control resize-y text-xs"
      />
      <div className="nodrag mt-2 grid grid-cols-2 gap-2">
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