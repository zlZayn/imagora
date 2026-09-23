import { memo, useEffect, useState, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Eye, RefreshCw, Trash2 } from "lucide-react";
import type { CanvasGroupNodeData, CanvasImageNodeData, CanvasPromptNodeData } from "../types";
import { generatingLabel } from "../format";
import { FolderPicker } from "./FolderPicker";
import { Select } from "./Select";

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
      className={`nodrag btn-ghost !px-1.5 !py-0.5 text-[10px] ${danger ? "btn-danger" : ""}`}
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
  lod,
  onReplace,
  onDelete,
  onZoom,
}: NodeProps<ImageFlowNode> & ImageNodeExtraProps & { lod?: boolean }) {
  // LOD 抽象模式：保留缩略图与双击放大，去掉右侧操作栏与引用行（节点多时轻量渲染）
  if (lod) {
    return (
      <div
        className={`panel-card relative !p-2 ${data.missing ? "!border-red-400" : ""} ${
          selected ? "node-selected" : ""
        }`}
      >
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
        <div
          className="h-40 w-32 cursor-zoom-in overflow-hidden rounded bg-neutral-50"
          onDoubleClick={(event) => {
            event.stopPropagation();
            onZoom(id);
          }}
        >
          {data.url ? (
            <img src={data.url} alt={data.name} className="block h-full w-full object-contain" draggable={false} />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] text-red-500">
              图片缺失
            </div>
          )}
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
        {data.url ? (
          <img src={data.url} alt={data.name} className="block h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] text-red-500">
            图片缺失
          </div>
        )}
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

export function GroupNode({
  id,
  data,
  selected,
  lod,
  onDelete,
}: NodeProps<GroupFlowNode> & GroupNodeExtraProps & { lod?: boolean }) {
  const mb = data.totalSize > 0 ? (data.totalSize / (1024 * 1024)).toFixed(1) : "0.0";
  // 去重标签：组链聚合含重复图片时（同一张图经多条路径到达），数字已是去重后实际张数，仅打标提示；
  // 配色跟随动态主题色（bg-brand/10 + text-brand，与组卡 bg-brand/5 同族，不引入孤立色相）
  const dup = data.duplicateCount ?? 0;
  const dupBadge = dup > 0 ? (
    <span
      className="mt-1 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium leading-none text-brand"
      title={`已去重 ${dup} 张重复图片`}
    >
      去重
    </span>
  ) : null;
  // LOD 抽象模式：去掉 hover 删除栏，只保留组本体（组节点本身已足够轻量）
  if (lod) {
    return (
      <div
        className={`relative w-56 rounded-lg bg-brand/5 !p-4 ${selected ? "node-selected" : ""}`}
      >
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
        <div className="py-2 text-center">
          <div className="text-xl font-semibold leading-tight text-brand-dark">
            {data.imageCount} 张图
          </div>
          <div className="mt-1 text-base text-neutral-500">{mb} MB</div>
          {dupBadge}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`group relative w-56 rounded-lg bg-brand/5 !p-4 node-pop ${selected ? "node-selected" : ""}`}
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
        {dupBadge}
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

/* 秒数文字：以 startedAtMs 锚定、组件内部每秒自计时刷新——只重渲染自身文字，
 * 不触碰状态灯 / 卡片其余部分（原逐秒写节点 data 导致悬停闪烁）。 */
function ElapsedText({ startedAtMs }: { startedAtMs?: number }) {
  const [seconds, setSeconds] = useState(() =>
    startedAtMs ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0,
  );
  useEffect(() => {
    if (!startedAtMs) return;
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAtMs]);
  return <>{generatingLabel(seconds)}</>;
}

/* 状态指示灯：圆点颜色映射状态，悬停 title 看详情（张数 / 失败原因），
 * 就绪灰、排队琥珀、生成中品牌色呼吸、完成绿、失败红。
 * 生成中的秒数刻意不进 title（挂 tooltip 每秒跳字 → 悬停闪烁），秒数只在运行按钮文字上走。 */
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
      title = "生成中";
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

/** LOD 抽象模式的提示词状态摘要：居中大字展示；title 带完整详情 */
function promptStatusSummary(data: CanvasPromptNodeData): { text: string; detail: string; className: string } {
  switch (data.status) {
    case "queued":
      return { text: "排队中", detail: "排队中", className: "text-amber-500" };
    case "running":
      return {
        text: "生成中",
        detail: "生成中",
        className: "animate-pulse text-brand",
      };
    case "done":
      return {
        text: `完成 · ${data.resultCount ?? 0} 张`,
        detail: `完成 · ${data.resultCount ?? 0} 张`,
        className: "text-green-600",
      };
    case "failed":
      return { text: "失败", detail: data.message ? `失败：${data.message}` : "失败", className: "text-red-500" };
    default:
      return { text: "就绪", detail: "就绪", className: "text-neutral-400" };
  }
}

export const PromptNode = memo(function PromptNode({
  id,
  data,
  selected,
  lod,
  onUpdate,
  onRun,
  onDelete,
  sizeOptions,
  qualityOptions,
}: PromptNodeProps & { lod?: boolean }) {
  const running = data.status === "running";
  const queued = data.status === "queued";
  const busy = running || queued;
  // LOD 抽象模式：标题大字 + 状态居中，不可编辑、无运行按钮；保留连接把手与拖拽
  if (lod) {
    const summary = promptStatusSummary(data);
    return (
      <div
        className={`panel-card flex min-h-[320px] !w-[380px] flex-col items-center justify-center gap-3 !p-3 ${selected ? "node-selected" : ""}`}
      >
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
        <div
          className="max-w-full truncate text-center text-3xl font-semibold leading-tight text-brand-dark"
          title={data.title ?? "提示词生成"}
        >
          {data.title ?? "提示词生成"}
        </div>
        <div className={`max-w-full truncate text-center text-xl font-medium ${summary.className}`} title={summary.detail}>
          {running ? <ElapsedText startedAtMs={data.startedAtMs} /> : summary.text}
        </div>
      </div>
    );
  }
  return (
    <div className={`panel-card group relative !w-[380px] min-w-0 !p-3 node-pop ${selected ? "node-selected" : ""}`}>
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
      <div
        className="mb-2 truncate text-xs font-semibold text-brand-dark"
        title={data.title ?? "提示词生成"}
      >
        {data.title ?? "提示词生成"}
      </div>
      <textarea
        value={data.prompt}
        onChange={(e) => onUpdate(id, { prompt: e.target.value })}
        rows={5}
        placeholder="英文提示词，例如：a red apple on white background"
        className="nodrag field-control resize-y text-xs leading-relaxed"
      />
      <div className="nodrag mt-2 grid grid-cols-[7fr_3fr] gap-2">
        <div className="min-w-0">
          <label className="field-label text-[10px]">尺寸</label>
          <Select
            options={sizeOptions}
            value={data.size}
            onChange={(v) => onUpdate(id, { size: v })}
            className="mt-0.5"
          />
        </div>
        <div className="min-w-0">
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
          <FolderPicker value={data.outputDir} onChange={(v) => onUpdate(id, { outputDir: v })} alignEnd />
        </div>
      </div>
      <div className="nodrag mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onRun(id)}
          disabled={busy || !data.prompt.trim()}
          className={`btn-primary flex-1 !py-1 text-xs ${busy ? "btn-busy" : ""}`}
        >
          {running ? <ElapsedText startedAtMs={data.startedAtMs} /> : queued ? "排队中..." : "运行"}
        </button>
      </div>
    </div>
  );
});
