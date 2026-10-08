// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  BACKGROUND_PRESETS,
  BACKGROUND_PRESET_STORAGE_KEY,
  DEFAULT_BACKGROUND_PRESET,
  PRESET_MATERIALS,
  PRESET_WALLPAPERS,
  isBackgroundPresetId,
  presetWallpaperOf,
  readBackgroundPreset,
  saveBackgroundPreset,
} from "./backgroundPreset";

describe("预设清单", () => {
  it("id 不重复，且默认项排在最前（界面顺序即数组顺序）", () => {
    const ids = BACKGROUND_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(DEFAULT_BACKGROUND_PRESET);
  });

  it("每一项都有中文标签与提示，不留空", () => {
    for (const preset of BACKGROUND_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.hint.trim().length).toBeGreaterThan(0);
    }
  });

  it("不含深色**材质**预设（暗房要整套深色界面，属独立工程）", () => {
    const materialIds = PRESET_MATERIALS.map((preset) => preset.id) as string[];
    expect(materialIds).not.toContain("dark");
    expect(materialIds).not.toContain("darkroom");
    expect(materialIds).not.toContain("blueprint");
  });
});

describe("材质与内置壁纸分成两组", () => {
  it("两组互不重叠，合起来就是全部预设（不漏项）", () => {
    const materialIds = PRESET_MATERIALS.map((preset) => preset.id);
    const wallpaperIds = PRESET_WALLPAPERS.map((preset) => preset.id);
    expect(materialIds.length + wallpaperIds.length).toBe(BACKGROUND_PRESETS.length);
    expect(materialIds.filter((id) => wallpaperIds.includes(id))).toEqual([]);
  });

  it("壁纸组全都有 URL，材质组一个都没有", () => {
    for (const preset of PRESET_WALLPAPERS) {
      expect(preset.wallpaper).toMatch(/^\/wallpapers\/.+\.jpg$/);
    }
    for (const preset of PRESET_MATERIALS) {
      expect(preset.wallpaper).toBeUndefined();
    }
  });

  it("两张内置壁纸都在（用户点名要的龙 / 神兽）", () => {
    expect(PRESET_WALLPAPERS.map((preset) => preset.id)).toEqual(["dragon", "tiger"]);
  });

  it("presetWallpaperOf：壁纸 id 给 URL，材质 id 给 null（含非法 id）", () => {
    expect(presetWallpaperOf("dragon")).toBe("/wallpapers/dragon.jpg");
    expect(presetWallpaperOf("tiger")).toBe("/wallpapers/tiger.jpg");
    for (const preset of PRESET_MATERIALS) {
      expect(presetWallpaperOf(preset.id)).toBeNull();
    }
    expect(presetWallpaperOf("不存在" as never)).toBeNull();
  });
});

describe("isBackgroundPresetId", () => {
  it("合法 id 为真，其余一律为假", () => {
    expect(isBackgroundPresetId("plain")).toBe(true);
    expect(isBackgroundPresetId("accent")).toBe(true);
    // 新增的两张内置壁纸也是合法选项，选中后要能持久化
    expect(isBackgroundPresetId("dragon")).toBe(true);
    expect(isBackgroundPresetId("tiger")).toBe(true);
    expect(isBackgroundPresetId("dark")).toBe(false);
    expect(isBackgroundPresetId("")).toBe(false);
    expect(isBackgroundPresetId(null)).toBe(false);
    expect(isBackgroundPresetId(42)).toBe(false);
    expect(isBackgroundPresetId({ id: "paper" })).toBe(false);
  });
});

describe("读写", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("未设置时回落默认（跟随主体色）", () => {
    expect(readBackgroundPreset()).toBe(DEFAULT_BACKGROUND_PRESET);
  });

  it("存进去能读回来", () => {
    saveBackgroundPreset("plain");
    expect(readBackgroundPreset()).toBe("plain");
  });

  it("存储里是非法值时回落默认，不抛错", () => {
    localStorage.setItem(BACKGROUND_PRESET_STORAGE_KEY, "不存在的预设");
    expect(readBackgroundPreset()).toBe(DEFAULT_BACKGROUND_PRESET);
    localStorage.setItem(BACKGROUND_PRESET_STORAGE_KEY, "null");
    expect(readBackgroundPreset()).toBe(DEFAULT_BACKGROUND_PRESET);
  });

  it("非法 id 不写进存储（不污染已有值）", () => {
    saveBackgroundPreset("plain");
    saveBackgroundPreset("dark" as never);
    expect(localStorage.getItem(BACKGROUND_PRESET_STORAGE_KEY)).toBe("plain");
  });

  it("每一项合法预设都能往返", () => {
    for (const preset of BACKGROUND_PRESETS) {
      saveBackgroundPreset(preset.id);
      expect(readBackgroundPreset()).toBe(preset.id);
    }
  });
});
