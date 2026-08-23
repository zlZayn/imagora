import { useEffect, useRef, useState, type MouseEvent } from "react";
import { formatBytes } from "../format";
import type { ResultItem } from "../types";
import { ZoomModal } from "./WorkflowModals";

interface GalleryProps {
  items: ResultItem[];
}

/**
 * 单图展示：自动包裹图片实际边缘。
 * 图片 `w-full h-auto`，高度由自身比例决定——不设固定占位比例、不 object-cover 裁切，
 * 加载完成前显示主题色浅调占位，图片就位后淡入（img-reveal），无比例跳变。
 * hover 由父级 group 驱动：图片轻微放大 + 阴影加深 + 整块上浮（transform 留给 transition，
 * 与入场 animation 互不干扰）。cursor-zoom-in 提示双击放大（与画布预览同款交互）。
 */
function AspectImage({ url, alt }: { url: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative w-full cursor-zoom-in overflow-hidden rounded-xl border border-neutral-200 bg-brand/5 shadow-sm transition-shadow duration-300 group-hover:shadow-md">
      {/* 加载中占位：图片就位后让位给实际比例 */}
      {!loaded && <div className="h-80 w-full" aria-hidden="true" />}
      <img
        src={url}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={`block h-auto w-full transition-transform duration-300 group-hover:scale-[1.03] ${
          loaded ? "img-reveal" : "opacity-0"
        }`}
      />
    </div>
  );
}

/**
 * 结果画廊：成功生成的图片网格展示。
 * 单击在新窗口打开原图；双击打开放大预览（ZoomModal 与画布同组件、同注册表 URL）。
 * 单击/双击用 250ms 延时区分：第二击到达即取消单击的「开原图」，再触发双击放大。
 */
export default function Gallery({ items }: GalleryProps) {
  const images = items.filter((item): item is ResultItem & { url: string } => Boolean(item.url));
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  /** 单击延时开原图：双击的第二击到达时取消，避免双击连开两个新标签 */
  const pendingOpenRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pendingOpenRef.current) window.clearTimeout(pendingOpenRef.current);
    },
    [],
  );

  if (images.length === 0) {
    return (
      <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-2 text-neutral-400">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
        <p className="text-sm">生成结果将显示在这里</p>
      </div>
    );
  }

  /** 单击：延时 250ms 开原图；250ms 内再来一击说明是双击，取消本次打开（交给 onDoubleClick） */
  const handleCardClick = (e: MouseEvent, item: ResultItem & { url: string }) => {
    e.preventDefault();
    if (pendingOpenRef.current) {
      window.clearTimeout(pendingOpenRef.current);
      pendingOpenRef.current = null;
      return;
    }
    pendingOpenRef.current = window.setTimeout(() => {
      pendingOpenRef.current = null;
      window.open(item.url, "_blank", "noopener");
    }, 250);
  };

  /** 双击：取消未决的单击开原图，改为放大预览 */
  const handleCardDoubleClick = (item: ResultItem & { url: string }) => {
    if (pendingOpenRef.current) {
      window.clearTimeout(pendingOpenRef.current);
      pendingOpenRef.current = null;
    }
    setZoom({ url: item.url, name: item.message });
  };

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-3">
        {images.map((item, i) => (
          <a
            key={`${item.url}-${i}`}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="group block enter-up"
            style={{ animationDelay: `${i * 70}ms` }}
            title="单击新窗口打开原图 · 双击放大预览"
          >
            <div
              className="transition-transform duration-300 group-hover:-translate-y-0.5"
              onClick={(e) => handleCardClick(e, item)}
              onDoubleClick={() => handleCardDoubleClick(item)}
            >
              <AspectImage url={item.url} alt={item.message} />
              <p className="text-caption mt-1 text-center">
                {item.size ? `${item.size}` : ""}
                {item.ext ? ` · ${item.ext.toUpperCase()}` : ""}
                {item.fileSize !== undefined ? ` · ${formatBytes(item.fileSize)}` : ""}
                {item.cost !== undefined ? ` · ${item.cost}元` : ""}
              </p>
            </div>
          </a>
        ))}
      </div>
      {zoom && <ZoomModal imageUrl={zoom.url} name={zoom.name} onClose={() => setZoom(null)} />}
    </>
  );
}
