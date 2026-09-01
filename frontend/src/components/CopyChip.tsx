import { useEffect, useRef, useState } from "react";

/** 复制反馈保持时长（ms） */
const COPIED_HOLD_MS = 1200;

/**
 * 路径词条：点击即复制完整路径（仿文件管理器路径栏的可点复制样式）。
 * 点击后不替换文字（避免按钮宽度跳动），改用边框/底色短暂高亮反馈 1.2s。
 */
export default function CopyChip({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // 剪贴板不可用（非安全上下文等）：静默失败，界面照常给点击反馈
    }
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_HOLD_MS);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="点击复制完整路径"
      aria-label={`复制路径 ${path}`}
      className={`mx-0.5 inline-block max-w-full cursor-pointer truncate rounded border px-1.5 align-bottom font-mono text-[11px] leading-5 transition-colors duration-200 ${
        copied
          ? "border-brand bg-brand/10 text-brand"
          : "border-neutral-200 bg-neutral-100 text-neutral-600 hover:border-brand/50 hover:bg-brand/5 hover:text-brand"
      }`}
    >
      {path}
    </button>
  );
}