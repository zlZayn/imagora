/**
 * 窗口主题色 —— 按窗口编号确定性取色，多开页面便于区分。
 * 编号不同 -> 色相差异大；同一编号 -> 颜色恒定（刷新不变）。
 * 黄金角 137.508° 分布保证相邻编号的颜色明显不同。
 */
export function accentForWindow(windowId: number | null): { brand: string; brandDark: string } {
  const hue = ((windowId ?? 1) - 1) * 137.508 % 360;
  return {
    brand: `hsl(${hue.toFixed(1)} 55% 42%)`,
    brandDark: `hsl(${hue.toFixed(1)} 55% 34%)`,
  };
}
