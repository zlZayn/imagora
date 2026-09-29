import logoSvg from './logo.svg?raw';

/**
 * 品牌图形的唯一来源就是同目录的 `logo.svg`：顶栏、动态 favicon、
 * 桌面图标（`scripts/desktop/make_icon.py`）全部从这里取。改形状只改那个文件，
 * 不必再同步散落的第二、第三份手抄副本。
 */

const PATH_D = /<path\s+d="([^"]+)"/.exec(logoSvg)?.[1];
const VIEW_BOX = /<svg[^>]*\sviewBox="([^"]+)"/.exec(logoSvg)?.[1];

if (PATH_D === undefined || VIEW_BOX === undefined) {
  throw new Error('brand/logo.svg 里取不到 <path d="…"> 或 viewBox，形状定义不完整');
}

/** 顶栏用：`<path d>` 的值。 */
export const BRAND_LOGO_PATH = PATH_D;

/** 顶栏用：根元素 viewBox，与形状同源，避免再抄一个数字。 */
export const BRAND_LOGO_VIEWBOX = VIEW_BOX;

/**
 * 整枚 SVG 字符串（动态 favicon 用）：只换根元素的 `fill`，
 * 形状与 viewBox 原样带过去。`fill` 由调用方给（窗口主题色），多窗口一眼可辨。
 */
export function brandLogoSvg(fill: string): string {
  return logoSvg.replace(/(<svg\b[^>]*?)\s+fill="[^"]*"/, `$1 fill="${fill}"`);
}
