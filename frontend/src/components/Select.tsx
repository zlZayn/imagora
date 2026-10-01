import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

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
 * 自定义下拉框：提供标准 listbox 语义、完整键盘导航和稳定的关闭行为。
 * 关闭时仍用 display:none，避免绝对定位列表撑高外层滚动容器。
 */
export function Select({ options, value, onChange, className = "", id }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reactId = useId();
  const listboxId = `${id ?? `select-${reactId}`}-listbox`;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const openList = (preferredIndex = selectedIndex >= 0 ? selectedIndex : 0) => {
    if (!options.length) return;
    setActiveIndex(Math.min(Math.max(preferredIndex, 0), options.length - 1));
    setOpen(true);
  };

  const closeList = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeList(true);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeList();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!options.length && open) {
      setOpen(false);
      setActiveIndex(-1);
    }
  }, [open, options.length]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab") {
      closeList();
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        closeList(true);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + options.length) % options.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!options.length) return;
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openList();
    }
  };

  return (
    <div ref={rootRef} className={`select-root relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        className="field-control select-trigger flex items-center justify-between gap-2 text-left"
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
          aria-hidden="true"
          className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <ul
        id={listboxId}
        role="listbox"
        className={`select-list absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto ${open ? "block" : "hidden"}`}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const active = index === activeIndex;
          return (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={selected}
              className={`select-option ${selected ? "is-selected" : ""} ${active ? "is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span className="truncate">{option.label}</span>
              {selected && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
