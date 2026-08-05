import { useEffect, useRef, useState } from "react";

interface UploadZoneProps {
  file: File | null;
  onChange: (file: File | null) => void;
}

/**
 * 参考图上传区：支持拖拽 / Ctrl+V 粘贴 / 点击添加（单选一张）
 * 显示当前底图缩略图，可移除。
 */
export default function UploadZone({ file, onChange }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef(file);
  fileRef.current = file;

  // 全局粘贴：剪贴板里的第一张图片作为底图（只绑定一次，用 ref 读最新值）
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.files;
      if (pasted && pasted.length) {
        onChange(pasted[0]);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onChange]);

  const addFile = (list: FileList | null) => {
    if (list && list.length) {
      onChange(list[0]);
    }
  };

  const baseClasses =
    "border-2 border-dashed rounded-xl p-4 text-center transition-all duration-300 cursor-pointer";
  const stateClasses = dragging
    ? "border-brand bg-brand/5 shadow-[0_0_0_4px_rgba(61,122,92,0.14)]"
    : "border-neutral-300 hover:border-brand hover:bg-brand/[0.03] hover:shadow-[0_0_0_3px_rgba(61,122,92,0.08)]";

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
        addFile(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          addFile(e.target.files);
          e.target.value = "";
        }}
      />
      {!file ? (
        <p className="text-sm text-neutral-500">
          拖拽图片到此处 / Ctrl+V 粘贴 / 点击添加 · 单张参考图
        </p>
      ) : (
        <div className="relative mx-auto w-fit">
          <img
            src={URL.createObjectURL(file)}
            alt={file.name}
            className="h-20 rounded-lg border border-neutral-200 object-cover"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-xs leading-none text-white hover:bg-neutral-600"
            aria-label="移除参考图"
          >
            x
          </button>
          <span className="mt-1 block max-w-[160px] truncate text-center text-[10px] text-neutral-500">
            {file.name}
          </span>
        </div>
      )}
    </div>
  );
}
