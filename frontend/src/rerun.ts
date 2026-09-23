import type { BatchSubmitItem, GenerationHistoryItem } from "./api";

/**
 * 「重跑失败项」纯逻辑：从历史条目里挑出可重跑的，并构造批量提交参数。
 *
 * 可重跑的条件（缺一即跳过并给出原因）：
 *   失败记录（status=error） + 有提示词 + 有尺寸 + 有质量 + 图生图记录的参考图还能找回来。
 * 参考图来源是账本 inputAssetIds 经注册表解析出的 inputRefs（.assets 永久副本），
 * 因此**早于参考图登记机制的旧失败记录无法重跑**（inputRefs 为空 → 明确提示，不静默降级成文生图）。
 */

/** 跳过原因：参考图找不回（与"不是失败记录"等条件区分，便于界面单独统计） */
export const RERUN_LOST_REFS = "参考图已丢失，无法还原图生图";

export interface RerunSkip {
  item: GenerationHistoryItem;
  reason: string;
}

export interface RerunPlan {
  /** 可重跑条目（保持传入顺序） */
  runnable: GenerationHistoryItem[];
  /** 被跳过条目 + 原因 */
  skipped: RerunSkip[];
  /** 其中因参考图丢失被跳过的条数（界面上单独提示用） */
  lostRefs: number;
}

/** 单条记录不可重跑的原因；可重跑返回 null */
export function rerunBlockReason(item: GenerationHistoryItem): string | null {
  if (item.status !== "error") return "不是失败记录";
  if (!item.prompt || !item.prompt.trim()) return "提示词为空";
  if (!item.size) return "缺少尺寸";
  if (!item.quality) return "缺少质量";
  const wantsRefs = (item.refs ?? 0) > 0 || item.mode === "img2img";
  const usableRefs = (item.inputRefs ?? []).filter((ref) => Boolean(ref.path));
  if (wantsRefs && usableRefs.length === 0) return RERUN_LOST_REFS;
  return null;
}

/** 把历史条目按「可重跑 / 跳过（带原因）」分组 */
export function planRerun(items: GenerationHistoryItem[]): RerunPlan {
  const runnable: GenerationHistoryItem[] = [];
  const skipped: RerunSkip[] = [];
  for (const item of items) {
    const reason = rerunBlockReason(item);
    if (reason) skipped.push({ item, reason });
    else runnable.push(item);
  }
  return {
    runnable,
    skipped,
    lostRefs: skipped.filter((s) => s.reason === RERUN_LOST_REFS).length,
  };
}

/** 可重跑条目 → 批量提交参数（参考图取注册表解析出的绝对路径） */
export function toBatchItems(items: GenerationHistoryItem[]): BatchSubmitItem[] {
  return items.map((item) => ({
    prompt: item.prompt ?? "",
    size: item.size ?? "",
    quality: item.quality ?? "",
    refPaths: (item.inputRefs ?? []).map((ref) => ref.path).filter(Boolean),
  }));
}

/** 跳过原因聚合（同一原因只显示一行 + 条数） */
export function groupSkipReasons(skipped: RerunSkip[]): { reason: string; count: number }[] {
  const grouped = new Map<string, number>();
  for (const row of skipped) {
    grouped.set(row.reason, (grouped.get(row.reason) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
