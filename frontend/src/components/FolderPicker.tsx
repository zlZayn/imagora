import { useState } from "react";
import { selectFolder } from "../api";

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
}

/**
 * 输出路径：可手输，或点击按钮弹出系统文件夹选择器（取消则保留原值）
 */
export default function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [picking, setPicking] = useState(false);

  const handlePick = async () => {
    setPicking(true);
    try {
      const { path } = await selectFolder(value);
      if (path) {
        onChange(path);
      }
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="图片保存目录"
        className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-brand/40"
      />
      <button
        type="button"
        onClick={handlePick}
        disabled={picking}
        className="whitespace-nowrap rounded-lg border border-neutral-300 px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
      >
        {picking ? "选择中..." : "选择文件夹"}
      </button>
    </div>
  );
}
