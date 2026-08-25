import { useCallback, useEffect, useState } from "react";

import { generationHistory, openFolder, type GenerationHistoryItem } from "../api";
import { errMessage } from "../format";
import { useImageZoom } from "../useImageZoom";
import { ZoomModal } from "./WorkflowModals";

function parentDirectory(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "");
}

export default function HistoryGallery({
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** 单击开原图 / 双击放大预览（与经典表单结果图同款交互，共用 ZoomModal） */
  const { zoom, handleClick, handleDoubleClick, closeZoom } = useImageZoom();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await generationHistory({ query, status, limit: 200 });
      setItems(result.items);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <section className="flex h-[86vh] w-[min(1100px,96vw)] flex-col overflow-hidden bg-[#f7f7f5] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-3">
          <h2 className="mr-2 text-sm font-semibold">生成历史</h2>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void load(); }}
            placeholder="搜索提示词、质量或文件名"
            className="field-control !w-72 !py-1"
          />
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="field-control !w-28 !py-1">
            <option value="">全部状态</option>
            <option value="ok">成功</option>
            <option value="error">失败</option>
          </select>
          <button type="button" className="btn-ghost !px-3 !py-1" onClick={() => void load()}>搜索</button>
          <button type="button" className="btn-ghost ml-auto !px-3 !py-1" onClick={onClose}>关闭</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {loading ? (
            <div className="py-16 text-center text-sm text-neutral-400">正在读取历史...</div>
          ) : items.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {items.map((item, index) => (
                <article key={`${item.time}-${item.output}-${index}`} className="overflow-hidden border border-neutral-200 bg-white">
                  <div className="flex aspect-square items-center justify-center bg-neutral-100">
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
                          <img src={item.url} alt={item.prompt || "生成结果"} loading="lazy" className="h-full w-full object-contain" />
                        </div>
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-400">{item.status === "error" ? "生成失败" : "文件已移动"}</span>
                    )}
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="line-clamp-3 min-h-12 text-xs leading-4 text-neutral-700" title={item.prompt}>{item.prompt || "无提示词"}</p>
                    <p className="text-[10px] text-neutral-400">{item.time} · {item.quality || "-"} · {item.size || "-"}</p>
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => void navigator.clipboard.writeText(item.prompt || "")}>复制提示词</button>
                      <button type="button" disabled={!item.path} className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => void openFolder(parentDirectory(item.path))}>打开目录</button>
                      <button type="button" disabled={!item.path} className="btn-ghost col-span-2 !px-2 !py-1 text-[11px]" onClick={() => void onImport(item.path)}>导入当前画布</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-sm text-neutral-400">没有匹配的生成记录</div>
          )}
        </div>
      </section>
      {zoom && <ZoomModal imageUrl={zoom.url} name={zoom.name} onClose={closeZoom} />}
    </div>
  );
}
