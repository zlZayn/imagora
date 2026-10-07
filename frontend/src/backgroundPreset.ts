/**
 * 背景预设 —— 整页背景可选几套现成材质，外加两张内置壁纸。
 *
 * 材质只做**浅色系**：纯白（默认）/ 跟随主体色 / 纸纤维 / 木纹 / 干净冷灰 / 雾面，外加"跟随主体色"（默认）。
 * 深色的「暗房」「蓝图」**不在此列**：它们不是换一层背景就完事，
 * 顶栏、卡片、文字、按钮都要同时换一套深色值，否则浅色文字控件压在深底上直接不可读。
 * 那属于独立的深色主题工程，等确认要做再单独立项。
 *
 * 内置壁纸（`wallpaper` 字段有值的那两项）是**另一条路**：它们不是 CSS 材质，
 * 而是整页铺满的图（cover、居中、不重复），铺法与用户自己上传的壁纸完全一致——
 * 因此选中它们时 App 会点亮 `html[data-wallpaper]`，一并得到同一套可读性处理
 * （壁纸降噪、卡片文字描边、页面底色让位）。不要试图用 `--bg-image` 铺它们：
 * 那条路是 repeat 的材质通道，铺满大图会平铺出接缝。
 *
 * 本模块只放纯数据与读写（无副作用、无 DOM），实际材质由 index.css 按 id 出。
 */

export type BackgroundPresetId =
  | "plain"
  | "accent"
  | "paper"
  | "wood"
  | "cool"
  | "mist"
  | "dragon"
  | "tiger";

export interface BackgroundPreset {
  id: BackgroundPresetId;
  label: string;
  /** 悬停提示：一句话说清这套材质是什么 */
  hint: string;
  /**
   * 整页壁纸图的 URL（内置预设壁纸才有；`public/wallpapers/` 下的静态文件，
   * 走站点根路径）。有它就表示这是「预设壁纸」，不是材质。
   */
  wallpaper?: string;
}

/** 顺序即界面顺序：默认项在最前；材质在前、内置壁纸在后（两类分开渲染） */
export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  { id: "plain", label: "纯白", hint: "纯白底、无纹理，与普通网页一致的默认观感" },
  { id: "accent", label: "跟随主体色", hint: "底色随主体色相变化，与按钮、角标同一色系" },
  { id: "paper", label: "纸纤维", hint: "暖米白纸底 + 纤维纹理" },
  { id: "wood", label: "木纹", hint: "暖木色底 + 细木纹" },
  { id: "cool", label: "干净冷灰", hint: "中性冷灰，无纹理" },
  { id: "mist", label: "雾面", hint: "浅灰雾面，极淡纹理" },
  {
    id: "dragon",
    label: "青玉游龙",
    hint: "青玉巨龙盘于云端仙宫之上（内置壁纸，按原图铺满）",
    wallpaper: "/wallpapers/dragon.jpg",
  },
  {
    id: "tiger",
    label: "晨曦神兽",
    hint: "金白神兽凌于云海古城之上（内置壁纸，按原图铺满）",
    wallpaper: "/wallpapers/tiger.jpg",
  },
] as const;

/**
 * 取某项的壁纸 URL；不是预设壁纸（是材质）时返回 null。
 * 写成函数而不是让调用方读 `preset.wallpaper ?? null`：可选属性在
 * `exactOptionalPropertyTypes` 下不能显式赋 undefined，收口成一处更好改。
 */
export function presetWallpaperOf(id: BackgroundPresetId): string | null {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id)?.wallpaper ?? null;
}

/** 预设壁纸项（材质之外的那两张），供界面单独成组渲染 */
export const PRESET_WALLPAPERS: readonly BackgroundPreset[] = BACKGROUND_PRESETS.filter(
  (preset) => preset.wallpaper !== undefined,
);

/** 材质项（不含内置壁纸），供界面单独成组渲染 */
export const PRESET_MATERIALS: readonly BackgroundPreset[] = BACKGROUND_PRESETS.filter(
  (preset) => preset.wallpaper === undefined,
);

/** 存储键（仅本机浏览器） */
export const BACKGROUND_PRESET_STORAGE_KEY = "imagora.background-preset.v1";

/**
 * 默认预设：纯白。
 *
 * 2026-10-07 维护者要求：不设置时就是「正常网页的白底」，不要再让页面底色跟着主体色走。
 * 早于这条的默认是「跟随主体色」（`hsl(色相 32% 93%)` + 两层同色系光晕）——
 * 主体色一旦调成品红，整页就发粉，用户描述为「背景不正常、改不回白底」。
 * 「跟随主体色」仍保留为可选项（id 未变，老用户存过的值照旧生效），只是不再是默认。
 */
export const DEFAULT_BACKGROUND_PRESET: BackgroundPresetId = "plain";

const IDS: readonly BackgroundPresetId[] = BACKGROUND_PRESETS.map((preset) => preset.id);

/** 是否是合法预设 id（外部数据 / 存储值都要先过这一关） */
export function isBackgroundPresetId(value: unknown): value is BackgroundPresetId {
  return typeof value === "string" && (IDS as readonly string[]).includes(value);
}

/** 读预设；未设置 / 非法值一律回落默认（不抛错，存储不可用也一样） */
export function readBackgroundPreset(): BackgroundPresetId {
  try {
    const raw = localStorage.getItem(BACKGROUND_PRESET_STORAGE_KEY);
    return isBackgroundPresetId(raw) ? raw : DEFAULT_BACKGROUND_PRESET;
  } catch {
    return DEFAULT_BACKGROUND_PRESET;
  }
}

/** 写预设；非法 id 忽略不写。存储不可用时静默不持久化，不影响本次会话。 */
export function saveBackgroundPreset(id: BackgroundPresetId): void {
  if (!isBackgroundPresetId(id)) return;
  try {
    localStorage.setItem(BACKGROUND_PRESET_STORAGE_KEY, id);
  } catch {
    /* 隐私模式等场景：不持久化即可 */
  }
}
