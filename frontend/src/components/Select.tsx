import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
}

/**
 * 自定义下拉框：展开面板带过渡动画，选项 hover / 选中态统一，
 * 点击外部或 Esc 关闭。替代原生 select（原生展开列表无法自定义样式）。
 */
export function Select({ options, value, onChange, className = "", id }: SelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const current = options.find((option) => option.value === value);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* 触发按钮 */}
      <button
        type="button"
        id={id}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="field-control flex items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 truncate">{current?.label ?? "请选择"}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* 展开面板 */}
      <ul
        role="listbox"
        className={`absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg transition-all duration-150 ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
        }`}
      >
        {options.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                option.value === value
                  ? "bg-brand/5 font-medium text-brand"
                  : "text-neutral-700 hover:bg-brand/5 hover:text-brand"
              }`}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
