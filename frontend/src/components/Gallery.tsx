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
      <div className="flex h-full min-h-[520px] items-center justify-center text-sm text-neutral-400">
        生成结果将显示在这里
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
          <p className="mt-1 text-center text-[11px] text-neutral-400">
            {item.size ? `${item.size}` : ""}
            {item.cost !== undefined ? ` · ${item.cost}元` : ""}
          </p>
        </a>
      ))}
    </div>
  );
}
