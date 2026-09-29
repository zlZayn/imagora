import { describe, expect, it } from 'vitest';
import logoSvg from './logo.svg?raw';
import { BRAND_LOGO_PATH, BRAND_LOGO_VIEWBOX, brandLogoSvg } from './logo';

/**
 * 形状只有一份：`logo.svg`。顶栏与动态 favicon 都从这里取，
 * 所以这里盯的是"源没被抄成第二份"（历史上 App.tsx 里手抄过两份，
 * 改 logo 要改三处，漏一处就出现顶栏新图、标签页旧图）。
 */
describe('brand/logo', () => {
  it('形状与 viewBox 都取自 logo.svg', () => {
    expect(BRAND_LOGO_PATH.startsWith('M')).toBe(true);
    expect(BRAND_LOGO_PATH.length).toBeGreaterThan(200);
    expect(BRAND_LOGO_VIEWBOX).toBe('0 0 1024 1024');
  });

  it('源文件里只有一处 fill 声明，否则换色会漏改', () => {
    expect((logoSvg.match(/fill="/g) ?? []).length).toBe(1);
  });

  it('brandLogoSvg 只换根元素 fill，形状与 viewBox 原样带过去', () => {
    const out = brandLogoSvg('#123456');
    expect(out).toContain('fill="#123456"');
    expect(out).not.toContain('475569');
    expect(out).toContain(BRAND_LOGO_PATH);
    expect((out.match(/<path\s/g) ?? []).length).toBe(1);
  });

  it('换色不改动 xmlns 与 viewBox（favicon 缺了 xmlns 就不显示）', () => {
    const out = brandLogoSvg('rgb(1, 2, 3)');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain(`viewBox="${BRAND_LOGO_VIEWBOX}"`);
  });
});
