/**
 * 卡片表面材质 —— 按主色相 + 通透度算出「白玻璃」的渐变字符串。
 *
 * 为什么在 JS 里拼字符串，而不是在 CSS 里写 `hsl(… / calc(0.66 * var(--x)))`：
 * 构建期的 CSS 压缩器会丢弃「函数里嵌 var()」的声明（实测：
 * `backdrop-filter: blur(var(--x))` 整条被删、`filter: blur(var(--x))` 亦然）。
 * 由 JS 产出**字面量**字符串再以行内变量注入，完全不经过压缩器，行为可预期；
 * 这也与既有 `--color-brand` 的做法一致（同样在 App 里内联注入）。
 *
 * 材质本身仍是 150deg 微渐变（同角度、同色系），层次靠档位区分：卡片 < 面板。
 *
 * 毛玻璃默认且当前恒为关闭（blurFor → `none`）：维护者要壁纸**原样**。
 * 历史：曾让模糊随通透度从 20px 涨到 80px 想换可读性，结果整卡变成奶白雾、
 * 壁纸被洗成灰白，比不透明更挡视线。教训写在 blurFor 上方。
 */

export interface SurfaceTokens {
  /** 卡片（--surface-card） */
  card: string;
  /** 面板（--surface-panel，比卡片高一档强度） */
  panel: string;
  /** 输入框底色（--field-bg） */
  field: string;
  /** 卡片、面板、输入框的毛玻璃（--surface-blur）。当前恒为 `none`：壁纸不糊，见 blurFor */
  blur: string;
}

/** 通透度区间：0 = 最实（接近全白），1 = 最透（接近全透明） */
export const SURFACE_TRANSPARENCY_LIMITS = { min: 0, max: 1 } as const;

/**
 * 默认通透度。取 0.55：比早期写死值（卡片 0.66/0.46）更透一档，
 * 因为维护者明确要求「再透明一些」。
 */
export const SURFACE_TRANSPARENCY_DEFAULT = 0.55;

/** 存储键（仅本机浏览器） */
export const SURFACE_TRANSPARENCY_STORAGE_KEY = "imagora.surface-transparency.v1";

/**
 * 通透度对不透明度的最大削弱比例。
 * 取 0.94：拉到 100% 时表面 alpha 只剩基准的 6%（卡片约 0.054）——
 * 视觉上就是「完全透明」，但保住一线白，按钮/输入框的浅色描边不会失去依托。
 * 以前「拉到头仍看不清」的锅不在这儿（6% 白纱挡不住任何东西），在 blurFor 的 80px 雾。
 */
const MAX_FADE = 0.94;

/** 各档的基准不透明度（通透度 0 时），取自早期硬编码的表面定义 */
const BASE = {
  cardTop: 0.9,
  cardBottom: 0.68,
  panelTop: 0.96,
  panelBottom: 0.8,
  field: 0.85,
} as const;

function clampNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SURFACE_TRANSPARENCY_LIMITS.max, Math.max(SURFACE_TRANSPARENCY_LIMITS.min, n));
}

/** 把任意入参钳到 [0, 1]；非法值回落默认 */
export function clampSurfaceTransparency(value: unknown): number {
  if (value === null || value === undefined || value === "") return SURFACE_TRANSPARENCY_DEFAULT;
  return clampNumber(value, SURFACE_TRANSPARENCY_DEFAULT);
}

/** 由基准不透明度与通透度算出实际 alpha（保留 3 位，避免超长字符串） */
function alphaOf(base: number, transparency: number): number {
  const t = clampSurfaceTransparency(transparency);
  return Math.round(base * (1 - MAX_FADE * t) * 1000) / 1000;
}

/**
 * 输入框（--field-bg）的不透明度下限。
 *
 * 为什么只有输入框有底线：卡片/面板是**大面积衬底**，拉到 0 也只是让壁纸露出来，
 * 里面装的是实体内容（文字、图片、日志），本来就该跟着壁纸走。
 * 输入框不一样——它的内容常常是**给用户看的浅灰底字**（placeholder "英文优先，减少歧义…"、
 * 下拉里的尺寸/质量），这些灰字压在花哨壁纸上会直接发飘；而控件本身又需要一条边界。
 * 25% 白足够让灰字站住、输入区一眼可辨，同时壁纸仍从底下透出来（不是一块白板）。
 *
 * 与 MAX_FADE 的关系：alphaOf 算完再取 max，所以**只有比 0.25 更透的档位会被抬回来**，
 * 通透度低的档位完全不受影响（0.85 基准一路下来，大约到 70% 通透度才触底）。
 */
export const FIELD_ALPHA_FLOOR = 0.25;

/**
 * 毛玻璃开关：`none` = 彻底关掉（默认，也是唯一取值）。
 *
 * 为什么连 8~12px 都不要：维护者要的就是**壁纸原样**。任何半径的毛玻璃都在卡片底下
 * 铺一层雾，雾一存在，壁纸的清晰度就打了折——而卡片真正需要的可读性，
 * 靠壁纸降噪（WALLPAPER_IMAGE_FILTER，保留明暗、只抽颜色）和文字的极淡白描边就够了，
 * 不需要模糊。这里的教训：模糊是「把背景弄走」的手段，不是「把背景变好看」的手段。
 *
 * 函数保留（而不是删掉、让 CSS 回落到兜底值）：整条字面量仍由 JS 注入，
 * 与 surfaceTokens 同路，将来要恢复可调时不改调用方。
 */
export function blurFor(_transparency: number): string {
  return "none";
}

/**
 * 壁纸生效时给壁纸加的降噪：稍微去饱和 + 压一点点对比。
 *
 * 为什么不是加一层半透明白（scrim）：白纱会把整张图提亮变灰，壁纸立刻失去层次，
 * 用户看到的还是「灰蒙蒙」。去饱和只抽掉颜色、保留明暗，画面安静下来、文字好读，
 * 但壁纸的细节和纵深还在——不靠遮挡，靠降噪。
 */
export const WALLPAPER_IMAGE_FILTER = "saturate(0.62) contrast(0.94)";

/**
 * 弹窗（`.modal-panel`）的专用不透明度下限。
 *
 * 为什么弹窗不与卡片同比透明：卡片是**大面积衬底**，透一点只是让壁纸露出来，
 * 里面装的是结果图与短文；弹窗装的是**密集表单**（配置项、键值、长提示），
 * 底下一花，逐行读值就费劲——同一档透明度在两者上的代价完全不同。
 *
 * 0.86 的来由：原先是写死的 .97，与卡片同比透明后会掉到 .46（实测），
 * 打开弹窗时能明显看到壁纸穿过来。0.86 保住"整页有壁纸"的一致观感，
 * 又能让表单文字稳稳压住背景（对比度与不透明档基本一致）。
 */
export const MODAL_ALPHA_FLOOR = 0.86;

/**
 * 算出整套表面材质。色相参与底色的冷暖（跟随主体色），通透度改 alpha 与毛玻璃。
 * 色相非法时按 0 处理（与 accent.ts 的归一策略一致）。
 */
export function surfaceTokens(hue: number, transparency: number): SurfaceTokens {
  const h = Number.isFinite(hue) ? (((hue % 360) + 360) % 360).toFixed(1) : "0.0";
  const t = clampSurfaceTransparency(transparency);
  return {
    card: `linear-gradient(150deg, hsl(${h} 26% 99.2% / ${alphaOf(BASE.cardTop, t)}), hsl(${h} 30% 96.8% / ${alphaOf(BASE.cardBottom, t)}))`,
    // 弹窗：同样的色相与渐变，但两个端点各自抬到下限之上（表单可读性优先）
    panel: `linear-gradient(150deg, hsl(${h} 30% 98.4% / ${Math.max(MODAL_ALPHA_FLOOR, alphaOf(BASE.panelTop, t))}), hsl(${h} 34% 94.8% / ${Math.max(MODAL_ALPHA_FLOOR, alphaOf(BASE.panelBottom, t))}))`,
    field: `rgba(255, 255, 255, ${Math.max(FIELD_ALPHA_FLOOR, alphaOf(BASE.field, t))})`,
    blur: blurFor(t),
  };
}

/** 读通透度；未设置 / 非法一律回落默认（存储不可用也一样，不抛错） */
export function readSurfaceTransparency(): number {
  try {
    const raw = localStorage.getItem(SURFACE_TRANSPARENCY_STORAGE_KEY);
    if (raw === null || raw.trim() === "") return SURFACE_TRANSPARENCY_DEFAULT;
    return clampSurfaceTransparency(Number(raw));
  } catch {
    return SURFACE_TRANSPARENCY_DEFAULT;
  }
}

/** 写通透度（写入前先钳制，存储里绝不落越界值）。存储不可用时静默不持久化。 */
export function saveSurfaceTransparency(transparency: number): void {
  try {
    localStorage.setItem(
      SURFACE_TRANSPARENCY_STORAGE_KEY,
      String(clampSurfaceTransparency(transparency)),
    );
  } catch {
    /* 隐私模式等场景：不持久化即可 */
  }
}
