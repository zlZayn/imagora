import { useEffect, useRef, useState } from "react";

interface UploadZoneProps {
  files: File[];
  onChange: (files: File[]) => void;
}

/**
 * 参考图上传区：支持拖拽 / Ctrl+V 粘贴 / 点击添加（可多张）
 * 多张参考图，具体怎么用由提示词决定。
 * 已选图片显示缩略图列表，可单独移除。
 */
export default function UploadZone({ files, onChange }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  /** 正在移除的文件名：先播 fade-out，动画结束才真正从列表移除 */
  const [removing, setRemoving] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  // 全局粘贴：剪贴板图片追加到底图列表（只绑定一次，用 ref 读最新值）
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.files;
      if (pasted && pasted.length) {
        onChange([...filesRef.current, ...Array.from(pasted)]);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onChange]);

  const addFiles = (list: FileList | null) => {
    if (list && list.length) {
      onChange([...files, ...Array.from(list)]);
    }
  };

  /** 移除：先标记，等 fade-out 播完再删，避免瞬移 */
  const removeFile = (file: File) => {
    setRemoving(file.name);
  };

  const finishRemove = (file: File) => {
    setRemoving(null);
    onChange(filesRef.current.filter((f) => f !== file));
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
      {files.length === 0 ? (
        <p className="text-sm text-neutral-500">
          拖拽图片到此处 / Ctrl+V 粘贴 / 点击添加 · 可多张
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-neutral-400">
            已选 {files.length} 张参考图
          </p>
          <ul className="flex flex-wrap justify-center gap-2">
            {files.map((file, i) => {
              const isRemoving = removing === file.name;
              return (
                <li
                  key={`${file.name}-${i}`}
                  className={`relative ${isRemoving ? "fade-out" : "pop-in"}`}
                  onAnimationEnd={isRemoving ? () => finishRemove(file) : undefined}
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-14 w-14 rounded-lg border border-neutral-200 object-cover"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file);
                    }}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-[10px] leading-none text-white"
                    aria-label={`移除 ${file.name}`}
                  >
                    x
                  </button>
                  <span className="absolute -bottom-4 left-0 max-w-[70px] truncate text-[10px] text-neutral-500">
                    {file.name}
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
