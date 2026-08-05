import type { ResultItem } from "../types";

interface GalleryProps {
  items: ResultItem[];
}

/**
 * 结果画廊：成功生成的图片网格展示，点击在新窗口打开原图
 */
export default function Gallery({ items }: GalleryProps) {
  const images = items.filter((item): item is ResultItem & { url: string } => Boolean(item.url));

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

  return (
    <div className="grid grid-cols-3 gap-3">
      {images.map((item, i) => (
        <a
          key={`${item.url}-${i}`}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title={item.message}
          className="block"
        >
          <img
            src={item.url}
            alt={item.message}
            className="aspect-[9/16] w-full rounded-xl border border-neutral-200 object-cover shadow-sm transition-shadow hover:shadow-md"
          />
          <p className="text-caption mt-1 text-center">
            {item.size ? `${item.size}` : ""}
            {item.cost !== undefined ? ` · ${item.cost}元` : ""}
          </p>
        </a>
      ))}
    </div>
  );
}
