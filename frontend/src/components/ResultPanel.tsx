import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Ban, Sparkles } from "lucide-react";

import { errMessage, generatingLabel } from "../format";
import type { GenerationTaskStatus, ResultItem } from "../types";
import { Gallery } from "./Gallery";

interface ResultPanelProps {
  /** 任务状态：queued/running/failed/cancelled 覆盖成状态面板；null/done 透传 Gallery */
  status: GenerationTaskStatus | null;
  /** 生成已用秒数（running 时随轮询刷新，面板主状态行显示） */
  elapsed: number;
  /** 本次提交参数摘要：生成中/排队的副文案（复用表单状态，不新开接口） */
  meta: {
    refCount: number;
    size: string;
    quality: string;
    outputDir: string;
  };
  /** 失败原因（failed 时显示；完整错误仍留在日志区） */
  error?: string | null;
  results: ResultItem[];
}

/** 状态切换时旧面板保留淡出的时长（须长于 swap-out 动画） */
const SWAP_OUT_MS = 200;

/** 状态 → 切换 key：gallery 态共用（results 变化不触发面板切换动画） */
function statusKey(status: GenerationTaskStatus | null): string {
  return status ?? "gallery";
}

/** 主图形层永远画面居中、副信息层钉在底部独立生长——行增减不挤动主图形 */
function StatusScene({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative h-full">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
        {children}
      </div>
      {footer && (
        <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-1 px-4 text-center">
          {footer}
        </div>
      )}
    </div>
  );
}

/** 状态环：排队琥珀（静态）/ 生成中品牌色呼吸 / 失败红 / 取消灰 */
function StatusRing({ tone, children }: { tone: "queued" | "running" | "failed" | "cancelled"; children: ReactNode }) {
  const cls =
    tone === "queued"
      ? "border-amber-400"
      : tone === "running"
        ? "border-brand pulse-glow"
        : tone === "failed"
          ? "border-red-400"
          : "border-neutral-300";
  return (
    <div className={`flex h-32 w-32 items-center justify-center rounded-full border-2 ${cls}`}>{children}</div>
  );
}

/** 根据状态渲染当前面板内容（含主/副两层） */
function renderScene(props: ResultPanelProps): ReactNode {
  const { status, elapsed, meta, error, results } = props;
  if (status === "queued" || status === "running") {
    const running = status === "running";
    return (
      <StatusScene
        footer={
          <>
            <div className="text-xs text-neutral-400">
              {meta.refCount > 0 ? "图生图" : "文生图"} · {meta.size} · {meta.quality}
              {meta.refCount > 0 ? ` · 参考图 ${meta.refCount} 张` : ""}
            </div>
            {running && <div className="text-[10px] text-neutral-400">约需 1-2 分钟 · 完成后自动显示在此处</div>}
            {meta.outputDir && (
              <div className="max-w-[85%] truncate text-[10px] text-neutral-400" title={meta.outputDir}>
                输出到 {meta.outputDir}
              </div>
            )}
          </>
        }
      >
        <StatusRing tone={running ? "running" : "queued"}>
          <Sparkles
            aria-hidden="true"
            size={64}
            className={running ? "icon-breathe text-brand" : "text-amber-500"}
          />
        </StatusRing>
        <div className={`text-sm font-medium ${running ? "text-brand" : "text-amber-600"}`}>
          {running ? generatingLabel(elapsed) : "排队中…"}
        </div>
      </StatusScene>
    );
  }

  if (status === "failed") {
    return (
      <StatusScene
        footer={
          <>
            <div className="max-w-[85%] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
              {errMessage(error ?? "未知错误")}
            </div>
            <div className="text-[10px] text-neutral-400">完整错误见下方日志 · 可修改参数后重新生成</div>
          </>
        }
      >
        <StatusRing tone="failed">
          <AlertTriangle aria-hidden="true" size={64} className="text-red-500" />
        </StatusRing>
        <div className="text-sm font-medium text-red-600">生成失败</div>
      </StatusScene>
    );
  }

  if (status === "cancelled") {
    return (
      <StatusScene>
        <StatusRing tone="cancelled">
          <Ban aria-hidden="true" size={64} className="text-neutral-400" />
        </StatusRing>
        <div className="text-sm font-medium text-neutral-500">生成已取消</div>
      </StatusScene>
    );
  }

  return <Gallery items={results} />;
}

/**
 * 经典表单结果区 5 态容器。
 * 布局：主图形层 absolute 居中钉死、副信息层 absolute 底部独立生长（行增减不挤动主图形）；
 * 切换：状态变化保留旧面板一层交叉淡出（swap-out），新面板淡入（swap-in），两层 absolute 叠放互不挤压——
 * 排队→生成中→失败/完成不再是硬切。完成/初始透传 Gallery（画廊功能零改动）。
 * 秒数只在右栏主状态行（视线位），按钮侧只留忙碌语义。
 */
export function ResultPanel(props: ResultPanelProps) {
  const key = statusKey(props.status);
  const node = renderScene(props);
  /** 状态切换时的旧面板快照（保留至淡出结束） */
  const [prev, setPrev] = useState<{ seq: number; node: ReactNode } | null>(null);
  const lastKeyRef = useRef(key);
  const lastNodeRef = useRef<ReactNode>(null);
  const prevSeqRef = useRef(0);

  // 渲染期状态调整（React 官方 derived-state 模式）：key 变化时把旧内容存为待淡出层
  if (lastKeyRef.current !== key) {
    setPrev({ seq: prevSeqRef.current++, node: lastNodeRef.current });
    lastKeyRef.current = key;
  }
  lastNodeRef.current = node;

  useEffect(() => {
    if (!prev) return;
    const timer = window.setTimeout(() => setPrev(null), SWAP_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [prev]);

  return (
    <div className="relative h-full min-h-[520px]">
      {prev && (
        <div key={`out-${prev.seq}`} className="swap-out absolute inset-0 overflow-auto">
          {prev.node}
        </div>
      )}
      <div key={key} className="swap-in absolute inset-0 overflow-auto">
        {node}
      </div>
    </div>
  );
}
