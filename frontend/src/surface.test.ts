// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  FIELD_ALPHA_FLOOR,
  MODAL_ALPHA_FLOOR,
  SURFACE_TRANSPARENCY_DEFAULT,
  SURFACE_TRANSPARENCY_STORAGE_KEY,
  clampSurfaceTransparency,
  readSurfaceTransparency,
  saveSurfaceTransparency,
  surfaceTokens,
} from "./surface";

/** 从材质字符串里取出所有 alpha（`/ 0.66)` 或 `, 0.57)`），便于断言 */
function alphasOf(value: string): number[] {
  return [...value.matchAll(/[/,]\s*(0?\.\d+|1|0)\s*\)/g)].map((m) => Number(m[1]));
}

describe("clampSurfaceTransparency", () => {
  it("区间外的值被夹回 [0, 1]", () => {
    expect(clampSurfaceTransparency(-1)).toBe(0);
    expect(clampSurfaceTransparency(2)).toBe(1);
  });

  it("空值 / 非法值回落默认", () => {
    expect(clampSurfaceTransparency(null)).toBe(SURFACE_TRANSPARENCY_DEFAULT);
    expect(clampSurfaceTransparency(undefined)).toBe(SURFACE_TRANSPARENCY_DEFAULT);
    expect(clampSurfaceTransparency("")).toBe(SURFACE_TRANSPARENCY_DEFAULT);
    expect(clampSurfaceTransparency(Number.NaN)).toBe(SURFACE_TRANSPARENCY_DEFAULT);
  });

  it("区间内原样返回", () => {
    expect(clampSurfaceTransparency(0.25)).toBe(0.25);
    expect(clampSurfaceTransparency("0.8")).toBe(0.8);
  });
});

describe("surfaceTokens", () => {
  it("三档齐备，且都是合法 CSS 值", () => {
    const tokens = surfaceTokens(224, SURFACE_TRANSPARENCY_DEFAULT);
    expect(tokens.card).toContain("linear-gradient(150deg");
    expect(tokens.panel).toContain("linear-gradient(150deg");
    expect(tokens.field).toMatch(/^rgba\(255, 255, 255, [\d.]+\)$/);
  });

  it("通透度越高，各档 alpha 越小（单调）", () => {
    const solid = surfaceTokens(224, 0);
    const mid = surfaceTokens(224, SURFACE_TRANSPARENCY_DEFAULT);
    const clear = surfaceTokens(224, 1);
    const avg = (v: string) => alphasOf(v).reduce((a, b) => a + b, 0) / alphasOf(v).length;
    expect(avg(solid.card)).toBeGreaterThan(avg(mid.card));
    expect(avg(mid.card)).toBeGreaterThan(avg(clear.card));
    expect(avg(solid.panel)).toBeGreaterThan(avg(clear.panel));
  });

  it("通透度 0 时落到基准不透明度（卡片 0.9 / 0.68）", () => {
    const tokens = surfaceTokens(0, 0);
    expect(alphasOf(tokens.card)).toEqual([0.9, 0.68]);
  });

  it("拉到最透时接近全透明（但仍不为 0，留一线白）", () => {
    const tokens = surfaceTokens(224, 1);
    for (const alpha of alphasOf(tokens.card)) {
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(0.1);
    }
  });

  it("毛玻璃彻底关闭：任何通透度都返回 none，绝不糊到壁纸", () => {
    for (const t of [0, 0.25, 0.55, 0.8, 1]) {
      expect(surfaceTokens(224, t).blur).toBe("none");
    }
    // 回归锁：老实现会返回 blur(20px)…blur(80px)，那层雾正是「看不清壁纸」的元凶
    expect(surfaceTokens(224, 1).blur).not.toMatch(/blur\(/);
  });

  it("输入框有 0.25 不透明度底线，保证灰字不飘；卡片不受此限", () => {
    const fieldAlphaAt = (t: number) => alphasOf(surfaceTokens(224, t).field)[0] ?? 0;
    expect(fieldAlphaAt(1)).toBe(FIELD_ALPHA_FLOOR);
    expect(fieldAlphaAt(0.9)).toBe(FIELD_ALPHA_FLOOR);
    // 低通透度档位不该被底线动到
    expect(fieldAlphaAt(0)).toBeCloseTo(0.85, 3);
    // 底线只保输入框：卡片的 alpha 仍一路降下去（全透约 0.05）
    expect(fieldAlphaAt(1)).toBeGreaterThan(alphasOf(surfaceTokens(224, 1).card)[0] ?? 0);
  });

  it("面板始终比卡片实一档（层次不反）", () => {
    const tokens = surfaceTokens(224, SURFACE_TRANSPARENCY_DEFAULT);
    const cardAvg = alphasOf(tokens.card).reduce((a, b) => a + b, 0) / 2;
    const panelAvg = alphasOf(tokens.panel).reduce((a, b) => a + b, 0) / 2;
    expect(panelAvg).toBeGreaterThan(cardAvg);
  });

  it("弹窗面板有不透明度下限：拉到最透也不低于 MODAL_ALPHA_FLOOR", () => {
    // 弹窗装的是密集表单，与卡片同比透明会让底下的壁纸穿上来、逐行读值费劲。
    // 原先 .modal-panel 是写死 .97（完全不受通透度影响），改成读 token 后
    // 必须补一道下限，否则拉到 100% 会掉到 .46（实测过）。
    const clear = surfaceTokens(224, 1);
    expect(Math.min(...alphasOf(clear.panel))).toBeGreaterThanOrEqual(MODAL_ALPHA_FLOOR);
    // 卡片不受这道下限约束（它本来就该跟着通透度走）
    expect(Math.min(...alphasOf(clear.card))).toBeLessThan(MODAL_ALPHA_FLOOR);
  });

  it("面板下限不至于让通透度失效：仍随通透度降低而变透", () => {
    const solid = alphasOf(surfaceTokens(224, 0).panel).reduce((a, b) => a + b, 0) / 2;
    const clear = alphasOf(surfaceTokens(224, 1).panel).reduce((a, b) => a + b, 0) / 2;
    expect(clear).toBeLessThan(solid);
  });

  it("色相参与底色：不同色相产出不同字符串，且色相被归一", () => {
    expect(surfaceTokens(224, 0.5).card).not.toBe(surfaceTokens(0, 0.5).card);
    expect(surfaceTokens(-136, 0.5).card).toBe(surfaceTokens(224, 0.5).card);
    expect(surfaceTokens(Number.NaN, 0.5).card).toBe(surfaceTokens(0, 0.5).card);
  });

  it("超长/非法通透度先钳制再计算，不产出坏值", () => {
    expect(surfaceTokens(224, 99).card).toBe(surfaceTokens(224, 1).card);
    expect(surfaceTokens(224, -5).card).toBe(surfaceTokens(224, 0).card);
    expect(surfaceTokens(224, Number.NaN).card).toBe(
      surfaceTokens(224, SURFACE_TRANSPARENCY_DEFAULT).card,
    );
  });
});

describe("读写", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("未设置时回落默认", () => {
    expect(readSurfaceTransparency()).toBe(SURFACE_TRANSPARENCY_DEFAULT);
  });

  it("存进去能读回来（越界先钳制）", () => {
    saveSurfaceTransparency(0.3);
    expect(readSurfaceTransparency()).toBe(0.3);
    saveSurfaceTransparency(5);
    expect(readSurfaceTransparency()).toBe(1);
  });

  it("存储里是坏值时回落默认，不抛错", () => {
    localStorage.setItem(SURFACE_TRANSPARENCY_STORAGE_KEY, "abc");
    expect(readSurfaceTransparency()).toBe(SURFACE_TRANSPARENCY_DEFAULT);
    localStorage.setItem(SURFACE_TRANSPARENCY_STORAGE_KEY, "  ");
    expect(readSurfaceTransparency()).toBe(SURFACE_TRANSPARENCY_DEFAULT);
  });
});
