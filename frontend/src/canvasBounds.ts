/**
 * 无限画布是否显示自己的边界（边框 + 底色）。
 *
 * 纯偏好项，没有图、没有服务端状态：一个布尔值落 localStorage，
 * 读写风格与 accent.ts / wallpaperStore.ts 一致 —— 非法 / 空白一律当未设置，try/catch 静默降级。
 *
 * 默认值刻意是 true：既有观感（画布是一张有边界有底色的面板）不能因为加开关而改变，
 * 只有用户显式关掉才进「与页面背景融为一体」的那一档。
 */

/** 画布边界开关的存储键（仅本机浏览器） */
export const CANVAS_BOUNDS_STORAGE_KEY = "imagora.canvas-bounds.v1";

/** 读画布边界开关；未设置 / 空白 / 非法一律回落默认值 true（= 显示边界） */
export function readCanvasBounds(): boolean {
  try {
    const raw = localStorage.getItem(CANVAS_BOUNDS_STORAGE_KEY);
    if (raw === null || raw.trim() === "") return true;
    return raw.trim() !== "0" && raw.trim() !== "false";
  } catch {
    return true;
  }
}

/** 写画布边界开关；存储不可用时静默不持久化（本次会话仍然生效） */
export function saveCanvasBounds(visible: boolean): void {
  try {
    localStorage.setItem(CANVAS_BOUNDS_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    /* 隐私模式等场景下 localStorage 不可用：不持久化，不影响本次会话 */
  }
}
