import { useMemo, useRef, useState } from "react";

import { parsePromptImportFormat, resolveCardSize, type PromptCardSpec } from "../promptImportFormat";
import type { SizeOption } from "../types";
import { ModalShell } from "./ModalShell";

interface PromptImportModalProps {
  /** 尺寸选项（由画布 config 派生传入，预览时按比例匹配真实尺寸） */
  sizes: SizeOption[];
  onConfirm: (cards: PromptCardSpec[]) => void;
  onClose: () => void;
}

/** 粘贴整段模型回复，实时解析并批量创建提示词卡片。 */
export function PromptImportModal({ sizes, onConfirm, onClose }: PromptImportModalProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { cards, issues } = useMemo(() => parsePromptImportFormat(text), [text]);

  return (
    <ModalShell
      title="粘贴导入提示词卡片"
      onClose={onClose}
      initialFocusRef={inputRef}
      className="modal-panel--lg prompt-import-modal"
    >
      <header className="modal-header">
        <h3 className="modal-title">粘贴导入提示词卡片</h3>
        <p className="modal-subtitle">
          粘贴模型回复。每张卡片由标题、文本围栏与首行比例组成。
        </p>
      </header>
      <textarea
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={10}
        aria-label="待导入的提示词文本"
        placeholder={"=== 示例图1 ===\n```text\nratio: 1:1\n\n（提示词正文）\n```"}
        className="field-control nodrag nowheel resize-y font-mono text-xs leading-relaxed"
      />
      <div className="modal-body prompt-import-preview" role="status" aria-live="polite">
        <div className="prompt-import-summary">
          <span>识别 {cards.length} 张卡片</span>
          {issues.length > 0 && <span className="prompt-import-summary__error">发现 {issues.length} 个问题</span>}
        </div>
        {cards.map((card) => {
          const size = resolveCardSize(card.ratio, sizes);
          return (
            <article key={card.title} className="prompt-import-card">
              <div className="prompt-import-card__meta">
                <strong>{card.title}</strong>
                <span>{card.ratio}</span>
                <span>{size.value}</span>
                {size.fallback && <span className="prompt-import-card__fallback">尺寸回退</span>}
              </div>
              <p>{card.prompt}</p>
            </article>
          );
        })}
        {issues.map((issue, index) => (
          <div key={`${issue.title ?? "issue"}-${index}`} className="prompt-import-issue">
            {issue.title ? `「${issue.title}」` : "当前内容"}：{issue.message}
          </div>
        ))}
        {!text.trim() && <div className="modal-empty">粘贴内容后将在这里实时预览</div>}
      </div>
      <footer className="modal-footer">
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={cards.length === 0}
          onClick={() => onConfirm(cards)}
        >
          确认建卡（{cards.length}）
        </button>
      </footer>
    </ModalShell>
  );
}
