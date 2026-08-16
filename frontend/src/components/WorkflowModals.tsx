import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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

/* ---------------- 放大预览：滚轮缩放 + 拖拽平移 + 适应窗口 ----------------
 * 状态收敛为一个 view 对象（zoom + pan），所有更新走同一 clampView 出口，
 * 缩放锚定指针位置（transform-origin 为图片中心时的精确补偿），放大后拖拽平移，
 * 双击复位 1:1，Esc / 点击遮罩关闭。 */

/** 预览缩放范围 */
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
/** 滚轮缩放步进 */
const ZOOM_STEP = 1.2;

interface PreviewView {
  zoom: number;
  pan: { x: number; y: number };
}

const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

export function ZoomModal({
  imagePath,
  name,
  onClose,
}: {
  imagePath: string;
  name: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<PreviewView>({ zoom: 1, pan: { x: 0, y: 0 } });
  /** 拖拽平移进行中（指针捕获期间持续更新；驱动光标样式与过渡开关） */
  const [dragging, setDragging] = useState(false);
  /** 图片自然尺寸（onLoad 后获得，供「适应窗口」计算） */
  const naturalRef = useRef<{ width: number; height: number } | null>(null);
  /** 图片布局盒（fit 到容器后的实际尺寸，缩放基准） */
  const imageBoxRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  /** 拖拽起点与起始平移（指针捕获期间持续更新） */
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  /** 图片可视区（90vw×85vh 容器，平移夹紧与缩放锚点都以它为基准） */
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  /** 限制平移范围：放大后至少让图片主体留在可视区内（中心对称夹紧） */
  const clampPan = useCallback((next: PreviewView): PreviewView => {
    const viewport = viewportRef.current;
    if (!viewport) return next;
    const { width: boxW, height: boxH } = imageBoxRef.current;
    if (!boxW || !boxH) return next;
    const scaledW = boxW * next.zoom;
    const scaledH = boxH * next.zoom;
    const maxX = Math.max(0, (scaledW - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (scaledH - viewport.clientHeight) / 2);
    return {
      zoom: next.zoom,
      pan: {
        x: Math.min(maxX, Math.max(-maxX, next.pan.x)),
        y: Math.min(maxY, Math.max(-maxY, next.pan.y)),
      },
    };
  }, []);

  const reset = useCallback(() => setView({ zoom: 1, pan: { x: 0, y: 0 } }), []);

  /** 适应窗口：按图片自然尺寸缩放到当前可视区（含边距），保持整图可见 */
  const fitToWindow = useCallback(() => {
    const natural = naturalRef.current;
    const wrap = wrapRef.current;
    if (!natural || !wrap) return;
    const availW = wrap.clientWidth * 0.9;
    const availH = wrap.clientHeight * 0.85;
    const zoom = clampZoom(Math.min(1, availW / natural.width, availH / natural.height));
    setView({ zoom, pan: { x: 0, y: 0 } });
  }, []);

  /** 滚轮缩放：以指针位置为锚点（原生非被动监听，保证 preventDefault 拦截页面滚动） */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = viewport.getBoundingClientRect();
      // 指针相对图片中心的偏移（缩放锚点）
      const cursorX = event.clientX - rect.left - rect.width / 2;
      const cursorY = event.clientY - rect.top - rect.height / 2;
      setView((prev) => {
        const zoom = clampZoom(event.deltaY < 0 ? prev.zoom * ZOOM_STEP : prev.zoom / ZOOM_STEP);
        if (zoom === prev.zoom) return prev;
        // 保持指针下的图像内容不动：pan' = p - (p - pan) * (zoom'/zoom)
        const k = zoom / prev.zoom;
        return clampPan({
          zoom,
          pan: { x: cursorX - (cursorX - prev.pan.x) * k, y: cursorY - (cursorY - prev.pan.y) * k },
        });
      });
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [clampPan]);

  /** Esc 关闭 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onPointerDown = (event: React.PointerEvent) => {
    // 未放大时无需平移；按下即捕获指针，移出图片也能继续拖
    if (view.zoom <= 1) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, panX: view.pan.x, panY: view.pan.y };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setView((prev) =>
      clampPan({
        ...prev,
        pan: { x: drag.panX + event.clientX - drag.startX, y: drag.panY + event.clientY - drag.startY },
      }),
    );
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div ref={viewportRef} className="relative flex h-[85vh] w-[90vw] items-center justify-center">
        <div
          className="flex h-full w-full touch-none items-center justify-center"
          style={{ cursor: dragging ? "grabbing" : view.zoom > 1 ? "grab" : "zoom-in" }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(e) => {
            e.stopPropagation();
            reset();
          }}
        >
          <img
            src={`/api/image?path=${encodeURIComponent(imagePath)}`}
            alt="预览"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              naturalRef.current = { width: img.naturalWidth, height: img.naturalHeight };
              imageBoxRef.current = { width: img.clientWidth, height: img.clientHeight };
            }}
            className="select-none object-contain"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`,
              transformOrigin: "center center",
              // 拖拽中禁用过渡，保证平移跟手；缩放/按钮操作保留轻微过渡
              transition: dragging ? "none" : "transform 0.1s ease-out",
            }}
          />
        </div>
      </div>
      {/* 控制条：缩放按钮 + 百分比 + 复位 / 适应窗口，nodrag 防误拖 */}
      <div
        className="mt-3 flex items-center gap-2 rounded-lg bg-black/40 px-2 py-1 text-xs text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="px-1.5 hover:text-brand" onClick={() => setView((prev) => clampPan({ ...prev, zoom: clampZoom(prev.zoom * ZOOM_STEP) }))} aria-label="放大">
          ＋
        </button>
        <button type="button" className="px-1.5 hover:text-brand" onClick={() => setView((prev) => clampPan({ ...prev, zoom: clampZoom(prev.zoom / ZOOM_STEP) }))} aria-label="缩小">
          －
        </button>
        <span className="w-12 text-center tabular-nums">{Math.round(view.zoom * 100)}%</span>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={fitToWindow}>
          适应窗口
        </button>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={reset}>
          1:1
        </button>
      </div>
      <div
        className="mt-2 max-w-[80vw] truncate rounded-md bg-black/40 px-3 py-1 text-xs text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </div>
      <div className="mt-1 text-[10px] text-white/50" onClick={(e) => e.stopPropagation()}>
        滚轮缩放 · 放大后拖拽平移 · 双击复位 · 点击空白处或 Esc 关闭
      </div>
    </div>
  );
}
