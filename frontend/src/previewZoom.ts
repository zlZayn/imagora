/**
 * 预览缩放纯函数：平移夹紧 + 缩放范围。
 * 与组件解耦便于单测——交互状态的数学边界集中在这里，改 UI 不碰算法。
 */

/** 预览缩放范围 */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 8;

export const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/**
 * 限制平移范围：放大后至少让图片主体留在可视区内（中心对称夹紧）。
 * @param pan 期望平移（px）
 * @param zoom 当前缩放
 * @param box 图片布局盒（fit 到容器后的实际尺寸）
 * @param viewport 可视区尺寸
 */
export function clampPreviewPan(
  pan: { x: number; y: number },
  zoom: number,
  box: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  if (!box.width || !box.height) return pan;
  const scaledW = box.width * zoom;
  const scaledH = box.height * zoom;
  const maxX = Math.max(0, (scaledW - viewport.width) / 2);
  const maxY = Math.max(0, (scaledH - viewport.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}
