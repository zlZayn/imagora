import { useEffect, useRef, useState } from "react";

interface UploadZoneProps {
  files: File[];
  onChange: (files: File[]) => void;
}

/**
 * 参考图上传区：支持拖拽 / Ctrl+V 粘贴 / 点击添加（多选）
 * 已选文件显示缩略图列表，可单独移除。
 */
export default function UploadZone({ files, onChange }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  // 全局粘贴：剪贴板里的图片直接加入（只绑定一次，用 ref 读最新文件列表）
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

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
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
          拖拽图片到此处 / Ctrl+V 粘贴 / 点击添加 · 多张逐张生成
        </p>
      ) : (
        <ul className="flex flex-wrap justify-center gap-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="relative">
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                className="h-14 w-14 rounded-lg border border-neutral-200 object-cover"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
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
          ))}
        </ul>
      )}
    </div>
  );
}
