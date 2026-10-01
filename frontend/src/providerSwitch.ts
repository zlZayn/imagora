/** 「模型选择」（服务来源）切换时的表单变更规则。
 *
 *  这里放纯函数而非内联在组件里，是因为它有一条容易写错、且后果不轻的规则：
 *  跨来源切换必须清空 API Key —— 豆包的 ark- Key 与中转站的 sk- Key 分属两套体系，
 *  留着上一个来源的 Key 会让用户以为「已经配好了」，实际调用必然 401。
 */

export interface ProviderLike {
  id: string;
  baseUrl: string;
  apiPath: string;
  model: string;
}

export interface ApiFormLike {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiPath: string;
}

/**
 * 计算切换来源后的表单。
 *
 * @param prev        切换前的表单
 * @param next        目标来源（null 表示清空选择）
 * @param prevProviderId 切换前选中的来源 id（空串代表尚未选择）
 * @returns 新表单；Key 仅在「确实换了个来源」时清空
 *
 * 规则：
 * - 空 → 选第一个：保留用户可能已手填的 Key（首次选择不该抹掉输入）
 * - A → B：清空 Key（两套 Key 不通用）
 * - A → A：保留 Key（重复点同一项是无操作）
 * - 选了未知来源（自定义地址）：只更新 providerId，表单不动
 */
export function applyProviderToForm(
  prev: ApiFormLike,
  next: ProviderLike | null,
  prevProviderId: string,
): ApiFormLike {
  if (!next) return prev;

  const switched = prevProviderId !== "" && prevProviderId !== next.id;
  return {
    ...prev,
    baseUrl: next.baseUrl,
    apiPath: next.apiPath,
    model: next.model,
    apiKey: switched ? "" : prev.apiKey,
  };
}
