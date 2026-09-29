/**
 * 最近用过的提示词 —— 从生成历史里挑出可直接复用的条目。
 *
 * 用途：经典表单结果区空态时展示，点一条填回提示词框，
 *      省去重新寻找那条很长的提示词（真实用法里提示词常达数百字、反复微调）。
 *
 * 口径：
 * - 入参已按时间倒序（/api/history 的返回顺序），本函数不再排序；
 * - **按前 `prefixLen` 字归并**：真实历史里同一条提示词常有多个只在尾部不同的近似版本
 *   （逐次微调留下的），精确去重会让列表出现多条肉眼完全相同、无法分辨的项；
 *   归并后只保留最新那条，完整文本仍由展示层的 title 提供；
 * - 丢弃空白项；
 * - 只做挑选，不截断长度（展示层负责视觉截断）。
 */
export function pickRecentPrompts(
  items: { prompt?: string | undefined }[],
  limit = 5,
  prefixLen = 40,
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const prompt = (item.prompt ?? "").trim();
    if (!prompt) continue;
    // 归并键：先把连续空白归一（避免空格数量差异造成假区分），再取前 prefixLen 字
    const key = prompt.replace(/\s+/g, " ").slice(0, prefixLen);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(prompt);
    if (picked.length >= limit) break;
  }
  return picked;
}
