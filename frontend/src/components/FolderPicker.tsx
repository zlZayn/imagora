import { useState } from "react";
import { selectFolder } from "../api";

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  /** 紧凑容器中优先显示路径末端，完整值通过 title 查看。 */
  alignEnd?: boolean;
}

/**
 * 输出路径：可手输，或点击按钮弹出系统文件夹选择器（取消则保留原值）
 */
export default function FolderPicker({ value, onChange, alignEnd = false }: FolderPickerProps) {
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
        title={value}
        className={`field-control min-w-0 flex-1 ${alignEnd ? "text-right" : ""}`}
      />
      <button type="button" onClick={handlePick} disabled={picking} className="btn-ghost">
        {picking ? "选择中..." : "选择文件夹"}
      </button>
    </div>
  );
}
