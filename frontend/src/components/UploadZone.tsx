import { useEffect, useRef, useState } from "react";
import { deleteRef, uploadRefs } from "../api";
import { formatBytes } from "../format";
import type { RefItem } from "../types";

interface UploadZoneProps {
  refs: RefItem[];
  onChange: (refs: RefItem[]) => void;
}

/**
 * 参考图上传区：支持拖拽 / Ctrl+V 粘贴 / 点击添加（可多张）。
 * 添加即上传服务端（大图不走 sessionStorage，继承/生成只引用路径），
 * 每张显示文件名与大小；已选图片显示缩略图列表，可单独移除（移除同步删服务端文件）。
 */
export default function UploadZone({ refs, onChange }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  /** 正在移除的文件标识：先播 fade-out，动画结束才真正移除 */
  const [removing, setRemoving] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef(refs);
  refsRef.current = refs;

  // 全局粘贴：剪贴板图片追加到参考图列表（只绑定一次，用 ref 读最新值）
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.files;
      if (pasted && pasted.length) {
        addFiles(pasted);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 添加并上传：先本地占位（synced=false）即时显示，上传成功后替换为服务端元信息 */
  const addFiles = async (list: FileList | null) => {
    if (!list || !list.length) return;
    const incoming = Array.from(list);
    const placeholders: RefItem[] = incoming.map((file) => ({
      id: "",
      path: "",
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
      ext: file.name.split(".").pop()?.toLowerCase() || "",
      mime: file.type,
      file,
      synced: false,
    }));
    const next = [...refsRef.current, ...placeholders];
    onChange(next);
    try {
      const uploaded = await uploadRefs(incoming);
      // 同一请求内返回顺序与上传顺序一致，按位置挂回本地 File 引用
      const synced = uploaded.map((r, i) => ({ ...r, file: incoming[i], synced: true }));
      onChange([...refsRef.current.slice(0, refsRef.current.length - incoming.length), ...synced]);
    } catch {
      // 上传失败：保留占位（synced=false），生成时走 multipart 兜底，不阻断用户
    }
  };

  /** 移除：先标记，等 fade-out 播完再删，避免瞬移；已落盘的同时通知服务端删除 */
  const removeFile = (ref: RefItem) => {
    setRemoving(ref.id || ref.name);
  };

  const finishRemove = (ref: RefItem) => {
    setRemoving(null);
    if (ref.synced && ref.path) {
      deleteRef(ref.path).catch(() => {
        // 尽力而为：删除失败由服务端启动清理兜底，不阻断界面
      });
    }
    onChange(refsRef.current.filter((f) => f !== ref));
  };

  const baseClasses =
    "border-2 border-dashed rounded-xl p-4 text-center transition-all duration-300 cursor-pointer";
  const stateClasses = dragging
        ? "border-brand bg-brand/5 shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-brand)_14%,transparent)]"
        : "border-neutral-300 hover:border-brand hover:bg-brand/[0.03] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_8%,transparent)]";

  return (
    <div
      className={`${baseClasses} ${stateClasses}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {refs.length === 0 ? (
        <p className="text-sm text-neutral-500">
          拖拽图片到此处 / Ctrl+V 粘贴 / 点击添加 · 可多张
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-neutral-400">
            已选 {refs.length} 张参考图
          </p>
          <ul className="flex flex-wrap justify-center gap-2">
            {refs.map((ref, i) => {
              const isRemoving = removing === (ref.id || ref.name);
              return (
                <li
                  key={`${ref.name}-${i}`}
                  className={`relative ${isRemoving ? "fade-out" : "pop-in"}`}
                  onAnimationEnd={isRemoving ? () => finishRemove(ref) : undefined}
                >
                  <img
                    src={ref.url}
                    alt={ref.name}
                    className="h-14 w-14 rounded-lg border border-neutral-200 object-cover"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(ref);
                    }}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-[10px] leading-none text-white"
                    aria-label={`移除 ${ref.name}`}
                  >
                    x
                  </button>
                  <span
                    className="absolute -bottom-4 left-0 max-w-[90px] truncate text-[10px] text-neutral-500"
                    title={`${ref.name} · ${formatBytes(ref.size)}`}
                  >
                    {ref.name} · {formatBytes(ref.size)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
