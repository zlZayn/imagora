import { describe, expect, it } from "vitest";

import { accentForWindow } from "./accent";

describe("accentForWindow", () => {
  it("同一编号恒定取色（刷新不变），null 回落 1 号窗口", () => {
    expect(accentForWindow(3)).toEqual(accentForWindow(3));
    expect(accentForWindow(null)).toEqual(accentForWindow(1));
  });

  it("色相按黄金角分布，相邻编号差异明显", () => {
    expect(accentForWindow(1).brand).toBe("hsl(0.0 55% 42%)");
    expect(accentForWindow(2).brand).toBe("hsl(137.5 55% 42%)");
    expect(accentForWindow(3).brand).toBe("hsl(275.0 55% 42%)");
    // 4 号越过 360 后回绕，保证多开时色相仍落在同一分布上
    expect(accentForWindow(4).brand).toBe("hsl(52.5 55% 42%)");
  });

  it("brand 与 brandDark 只差明度，色相与饱和度同值", () => {
    const { brand, brandDark } = accentForWindow(7);
    const hueOf = (value: string) => value.match(/hsl\(([-\d.]+) (\d+%) (\d+%)\)/);
    const bright = hueOf(brand);
    const dark = hueOf(brandDark);
    expect(bright?.[1]).toBe(dark?.[1]);
    expect(bright?.[2]).toBe(dark?.[2]);
    expect(bright?.[3]).toBe("42%");
    expect(dark?.[3]).toBe("34%");
  });

  it("0 号（越界输入）取余保留负号，行为由本例钉住", () => {
    expect(accentForWindow(0).brand).toBe("hsl(-137.5 55% 42%)");
  });
});
