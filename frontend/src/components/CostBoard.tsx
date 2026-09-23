import { useEffect, useState } from "react";

import type { BudgetSettings, HistoryStats } from "../api";
import { budgetSummary, statRows } from "../cost";

/** 预算设置初值（stats 未加载时按"不限"显示） */
const EMPTY_BUDGET: BudgetSettings = { dailyLimit: 0, singleRunLimit: 0 };

/**
 * 成本看板：账本原始行聚合的关键指标 + 本机预算设置（当日上限 / 单次上限，0 = 不限）。
 * 只负责渲染与本地草稿：数据加载与保存都交给宿主（HistoryGallery），保持组件无副作用。
 */
export function CostBoard({
  stats,
  loading,
  onRefresh,
  onSaveBudget,
}: {
  stats: HistoryStats | null;
  loading: boolean;
  onRefresh: () => void;
  onSaveBudget: (settings: BudgetSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BudgetSettings>(EMPTY_BUDGET);
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState("");

  // stats 变化时同步草稿（用户未编辑时的默认值：后端已保存的预算）
  useEffect(() => {
    if (stats) {
      setDraft({ dailyLimit: stats.budget.dailyLimit, singleRunLimit: stats.budget.singleRunLimit });
    }
  }, [stats]);

  const handleSave = async () => {
    setSaving(true);
    setSavedTip("");
    try {
      await onSaveBudget(draft);
      setSavedTip("预算已保存");
    } catch (err) {
      setSavedTip(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const rows = stats ? statRows(stats) : [];
  const topSizes = stats?.bySize.slice(0, 3) ?? [];

  return (
    <section
      data-testid="cost-board"
      className="border-b border-neutral-200 bg-white px-4 py-2 text-[11px] text-neutral-600"
    >
      {loading && !stats ? (
        <span className="text-neutral-400">正在统计成本...</span>
      ) : stats ? (
        <div className="flex flex-col gap-1">
          {/* 第一行：左侧指标 + 预算摘要（自然宽度、不拆字），右侧预算设置（窗口窄时整组落到下一行） */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
              {rows.map((row) => (
                <span key={row.label} className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-neutral-400">{row.label}</span>
                  <span className="font-medium text-neutral-800">{row.value}</span>
                </span>
              ))}
              <span className="whitespace-nowrap text-neutral-400">{budgetSummary(stats.budget)}</span>
            </div>
            <div className="compact-controls ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                <span className="text-neutral-400">日预算</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={draft.dailyLimit}
                  onChange={(event) => setDraft((prev) => ({ ...prev, dailyLimit: Number(event.target.value) }))}
                  title="当日累计费用上限（元），0 = 不限；超限提交前会要求确认"
                  className="field-control !w-20 text-right"
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-neutral-400">单次上限</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={draft.singleRunLimit}
                  onChange={(event) => setDraft((prev) => ({ ...prev, singleRunLimit: Number(event.target.value) }))}
                  title="单次提交（含批量重跑）预估上限（元），0 = 不限"
                  className="field-control !w-20 text-right"
                />
              </label>
              <button type="button" className="btn-ghost" disabled={saving} onClick={() => void handleSave()}>
                {saving ? "保存中..." : "保存预算"}
              </button>
              <button type="button" className="btn-ghost" disabled={loading} onClick={onRefresh}>
                刷新
              </button>
              {savedTip && <span className="text-neutral-400">{savedTip}</span>}
            </div>
          </div>
          {/* 第二行：按尺寸明细（与指标同色阶，横向自然排开） */}
          {topSizes.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 whitespace-nowrap text-neutral-400">
              <span className="shrink-0">按尺寸</span>
              {topSizes.map((row) => (
                <span key={row.size}>
                  {row.size} ×{row.count} · {row.cost.toFixed(2)} 元
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span className="text-neutral-400">成本统计不可用</span>
      )}
    </section>
  );
}
