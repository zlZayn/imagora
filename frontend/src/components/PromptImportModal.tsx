import { useMemo, useState } from "react";

import { EXPECTED_CARDS, parsePromptImportFormat, resolveCardSize, type PromptCardSpec } from "../promptImportFormat";
import type { SizeOption } from "../types";

interface PromptImportModalProps {
  /** 尺寸选项（由画布 config 派生传入，预览时按比例匹配真实尺寸） */
  sizes: SizeOption[];
  onConfirm: (cards: PromptCardSpec[]) => void;
  onClose: () => void;
}

/**
 * 粘贴导入提示词卡片：把多模态模型按导入格式输出的整段回复粘进来，实时解析预览。
 * 解析出的合法卡片逐条展示（标题 / 比例 / 匹配尺寸 / 正文预览），
 * 有问题的条目（缺 ratio、重复标题等）标红列出；确认后批量建卡。
 */
export function PromptImportModal({ sizes, onConfirm, onClose }: PromptImportModalProps) {
  const [text, setText] = useState("");
  const { cards, issues } = useMemo(() => parsePromptImportFormat(text), [text]);
  const countMismatch = cards.length !== EXPECTED_CARDS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[42rem] max-w-[94vw] flex-col rounded-lg bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-semibold">粘贴导入提示词卡片</h3>
        <p className="mb-3 text-xs text-neutral-500">
          把模型回复整段粘贴到下方。导入格式：{"=== 标题 ==="} 行 + {"```text"} 围栏 + 块内首行 {"ratio: N:M"}。
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={"=== 轮播图1 ===\n```text\nratio: 1:1\n\n（提示词正文）\n```"}
          className="field-control nodrag nowheel resize-y font-mono text-xs leading-relaxed"
        />
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
          <div className="text-xs text-neutral-500">
            识别 {cards.length} 张卡片
            {countMismatch && cards.length > 0 && (
              <span className="ml-2 text-amber-600">预期 {EXPECTED_CARDS} 张，当前 {cards.length} 张</span>
            )}
            {issues.length > 0 && <span className="ml-2 text-red-500">发现 {issues.length} 个问题</span>}
          </div>
          {cards.map((card) => {
            const size = resolveCardSize(card.ratio, sizes);
            return (
              <div key={card.title} className="flex items-center gap-2 text-xs">
                <span className="shrink-0 font-medium text-neutral-800">{card.title}</span>
                <span className="shrink-0 text-neutral-400">{card.ratio}</span>
                <span className="shrink-0 text-neutral-500">{size.value}</span>
                {size.fallback && <span className="shrink-0 text-amber-600">尺寸回退</span>}
                <span className="min-w-0 truncate text-neutral-600">{card.prompt}</span>
              </div>
            );
          })}
          {issues.map((issue, i) => (
            <div key={i} className="text-xs text-red-500">
              {issue.title ? `「${issue.title}」` : ""}：{issue.message}
            </div>
          ))}
          {!text.trim() && <div className="py-2 text-center text-[11px] text-neutral-300">粘贴内容后实时预览</div>}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary !px-4 !py-1 text-xs"
            disabled={cards.length === 0}
            onClick={() => onConfirm(cards)}
          >
            确认建卡（{cards.length}）
          </button>
        </div>
      </div>
    </div>
  );
}
