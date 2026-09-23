import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { generationHistory, openFolder, type GenerationHistoryItem } from "../api";
import { errMessage } from "../format";
import { useImageZoom } from "../useImageZoom";
import { ZoomModal } from "./WorkflowModals";

function parentDirectory(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "");
}

/** 提示词行：先显示 2 行、超出省略（line-clamp-2）；仅当文字确实被截断时，悬浮在鼠标旁显示完整多行（短文案不弹无意义浮层）。
    浮层宽度固定为屏幕 80%（80vw）且水平居中（左/右各留 10vw，永不出屏），高度随行数自动长；
    垂直跟随鼠标 y 并 clamp 进视口（下边防溢出，靠挪位而非滚动条）。 */
function PromptCell({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipY, setTipY] = useState<number | null>(null);
  const [clampTop, setClampTop] = useState(0);

  const onEnter = (event: MouseEvent<HTMLParagraphElement>) => {
    const el = ref.current;
    // scrollHeight > clientHeight 即发生了 2 行截断，才需要浮层补全
    if (el && el.scrollHeight > el.clientHeight) {
      setTipY(event.clientY);
    }
  };
  const onMove = (event: MouseEvent<HTMLParagraphElement>) => {
    setTipY((cur) => (cur != null ? event.clientY : cur));
  };
  const onLeave = () => {
    setTipY(null);
    setClampTop(0);
  };

  // 浮层水平居中固定（10vw+80vw 恒在屏内）；垂直跟随鼠标 y 并 clamp 进视口（下边溢出靠挪位而非滚动条）
  useLayoutEffect(() => {
    if (tipY != null && tipRef.current) {
      const rect = tipRef.current.getBoundingClientRect();
      setClampTop(Math.max(8, Math.min(tipY + 16, window.innerHeight - rect.height - 8)));
    }
  }, [tipY, text]);

  const tipStyle: CSSProperties | undefined =
    tipY != null
      ? {
          // 宽固定屏幕 80% 且水平居中（左/右各留 10vw，永不出屏），高随行数自动长，无滚动条
          left: "10vw",
          top: clampTop,
          width: "80vw",
        }
      : undefined;

  return (
    <>
      <p
        ref={ref}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="line-clamp-2 text-xs leading-4 text-neutral-700"
      >
        {text}
      </p>
      {tipY != null && (
        <div
          ref={tipRef}
          data-testid="prompt-tip"
          className="pointer-events-none fixed z-50 rounded-md bg-neutral-800 px-3 py-2 text-xs leading-5 text-white shadow-lg"
          style={{ ...tipStyle, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {text}
        </div>
      )}
    </>
  );
}

export function HistoryGallery({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (path: string) => Promise<void>;
}) {
  const [items, setItems] = useState<GenerationHistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  /** 聚合后是否还有下一页（滚动到底 / 点「加载更多」追加，避免一次渲染 200 条卡顿） */
  const [hasMore, setHasMore] = useState(false);
  /** 首屏加载 / 翻页追加用两个独立状态，追加时不遮住已渲染列表 */
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  /** 滚动容器（接近底部自动翻页的判定基准） */
  const listRef = useRef<HTMLDivElement>(null);
  /** 请求代次：搜索/状态/重开变化自增，旧响应（竞态）丢弃 */
  const seqRef = useRef(0);
  /** 最新 items 长度镜像，翻页 offset 不依赖闭包里的过期 items */
  const itemsRef = useRef<GenerationHistoryItem[]>([]);
  /** query/status 镜像：回调保持稳定引用（open 打开 effect 只依赖 open），又能读到最新筛选值 */
  const queryRef = useRef(query);
  const statusRef = useRef(status);
  queryRef.current = query;
  statusRef.current = status;
  /** 单击开原图 / 双击放大预览（与经典表单结果图同款交互，共用 ZoomModal） */
  const { zoom, handleClick, handleDoubleClick, closeZoom } = useImageZoom();

  /** 分页大小：DOM 总量控制在单页数量级，滚动顺滑 */
  const PAGE_SIZE = 60;

  /** 首屏 / 搜索重载：重置分页从第 0 页拉取（overrides 用于 select 等"值刚变"的场景） */
  const load = useCallback(
    async (overrides?: { query?: string; status?: string }) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError("");
      try {
        const result = await generationHistory({
          limit: PAGE_SIZE,
          offset: 0,
          query: overrides?.query ?? queryRef.current,
          status: overrides?.status ?? statusRef.current,
        });
        if (seq !== seqRef.current) return; // 期间搜索/筛选已变，丢弃本次结果
        setItems(result.items);
        itemsRef.current = result.items;
        setHasMore(result.hasMore);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(errMessage(err));
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [],
  );

  /** 追加下一页：offset = 当前已加载条数（聚合后语义，见 /api/history 契约） */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const seq = seqRef.current;
    setLoadingMore(true);
    setError("");
    try {
      const result = await generationHistory({
        limit: PAGE_SIZE,
        offset: itemsRef.current.length,
        query: queryRef.current,
        status: statusRef.current,
      });
      if (seq !== seqRef.current) return;
      setItems((prev) => [...prev, ...result.items]);
      itemsRef.current = [...itemsRef.current, ...result.items];
      setHasMore(result.hasMore);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(errMessage(err));
    } finally {
      if (seq === seqRef.current) setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  /** 接近底部阈值（px）：提前预载下一页，滚到手感不间断 */
  const NEAR_BOTTOM_PX = 600;

  /** 滚动接近底部 → 自动翻页（loadMore 内部有 hasMore/loadingMore 守卫，高频滚动安全） */
  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX) void loadMore();
  }, [loadMore]);

  /** 追加后仍未占满可视区（历史总量 < 一个视口）→ 自动续拉直到填满或无更多；
   *  clientHeight===0 判定"未布局"环境（jsdom 无滚动布局）跳过，避免测试里连锁拉空 mock。 */
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || !hasMore || loadingMore) return;
    if (list.clientHeight === 0) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX) void loadMore();
  }, [open, items.length, hasMore, loadingMore, loadMore]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <section className="flex h-[86vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-lg bg-[#f7f7f5] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-3">
          <h2 className="mr-2 text-sm font-semibold">生成历史</h2>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void load(); }}
            placeholder="搜索提示词、质量或文件名"
            className="field-control !w-72 !py-1"
          />
          <select value={status} onChange={(event) => { const next = event.target.value; setStatus(next); void load({ status: next }); }} className="field-control !w-28 !py-1">
            <option value="">全部状态</option>
            <option value="ok">成功</option>
            <option value="error">失败</option>
          </select>
          <button type="button" className="btn-ghost !px-3 !py-1" onClick={() => void load()}>搜索</button>
          <button type="button" className="btn-ghost ml-auto !px-3 !py-1" onClick={onClose}>关闭</button>
        </header>
        <div ref={listRef} data-testid="history-list" onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto p-4">
          {error && <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {loading ? (
            <div className="py-16 text-center text-sm text-neutral-400">正在读取历史...</div>
          ) : items.length ? (
            /* 列表视图：两栏网格卡片。横排卡片——左侧 160px 结果图占满卡片高度，
               右侧提示词随容器宽（2 行截断）+ 大参考图 + 全文字按钮（底部对齐）；结果图 min-h-36 兜底卡片高度。 */
            <>
              <ul className="grid grid-cols-2 gap-3">
              {items.map((item, index) => (
                <li key={`${item.time}-${item.output}-${index}`} className="flex gap-3 rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="w-40 min-h-36 flex-none self-stretch overflow-hidden bg-neutral-100">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block h-full w-full"
                        title="单击新窗口打开原图 · 双击放大预览"
                      >
                        <div
                          className="h-full w-full cursor-zoom-in"
                          onClick={(e) => handleClick(e, { url: item.url, name: item.prompt || "生成结果" })}
                          onDoubleClick={() => handleDoubleClick({ url: item.url, name: item.prompt || "生成结果" })}
                        >
                          <img src={item.url} alt={item.prompt || "生成结果"} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                        </div>
                      </a>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-1">
                        <span className="text-center text-[11px] leading-tight text-neutral-400">{item.status === "error" ? "生成失败" : "文件已移动"}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <PromptCell text={item.prompt || "无提示词"} />
                    <p className="text-[10px] text-neutral-400">{item.time} · {item.quality || "-"} · {item.size || "-"}</p>
                    {item.inputRefs && item.inputRefs.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.inputRefs.map((ref) => (
                          <div
                            key={ref.id}
                            className="h-14 w-14 cursor-zoom-in overflow-hidden border border-neutral-200 bg-neutral-100"
                            title="单击新窗口打开参考图 · 双击放大预览"
                            onClick={(e) => handleClick(e, { url: ref.url, name: "参考图" })}
                            onDoubleClick={() => handleDoubleClick({ url: ref.url, name: "参考图" })}
                          >
                            <img src={ref.url} alt="参考图" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    )}
                    {item.inputRefMissing && <p className="text-[10px] text-amber-600">参考图缺失</p>}
                    <div className="mt-auto flex gap-1.5">
                      <button type="button" className="btn-ghost min-w-0 flex-1 !px-1.5 !py-1 text-[11px]" onClick={() => void navigator.clipboard.writeText(item.prompt || "")}>复制提示词</button>
                      <button type="button" disabled={!item.path} className="btn-ghost min-w-0 flex-1 !px-1.5 !py-1 text-[11px]" onClick={() => void openFolder(parentDirectory(item.path))}>打开目录</button>
                      <button type="button" disabled={!item.path} className="btn-primary min-w-0 flex-1 !px-1.5 !py-1 text-[11px]" onClick={() => void onImport(item.path)}>导入当前画布</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {/* 底部翻页区：滚动接近底部自动加载，按钮仅作手动兜底 */}
            <div className="py-3 text-center text-xs text-neutral-400">
              {loadingMore ? (
                "正在加载更多..."
              ) : hasMore ? (
                <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => void loadMore()}>
                  加载更多
                </button>
              ) : (
                "已显示全部记录"
              )}
            </div>
            </>
          ) : (
            <div className="py-16 text-center text-sm text-neutral-400">没有匹配的生成记录</div>
          )}
        </div>
      </section>
      {zoom && <ZoomModal imageUrl={zoom.url} name={zoom.name} onClose={closeZoom} />}
    </div>
  );
}
