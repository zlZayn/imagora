// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearWallpaperImage,
  purgeLegacyWallpaperSettings,
  readWallpaperImage,
  saveWallpaperImage,
} from "./wallpaperStore";

/**
 * 这里覆盖的是**降级路径**：存储不可用（缺失 / 被策略阻断 / 打开失败）时，
 * 三个函数必须安静返回，绝不抛错、不挡住生图主流程。成功读写路径由真机浏览器验证。
 *
 * 注意：本项目的 jsdom 环境里**没有 `indexedDB` 这个全局**（连声明都没有），
 * 所以想测「open 失败」必须先用 vi.stubGlobal 把它造出来，否则直接引用会 ReferenceError。
 */
describe("旧版壁纸参数键一次性清理", () => {
  const LEGACY = "imagora.wallpaper-settings.v1";
  beforeEach(() => {
    localStorage.clear();
  });

  it("删掉遗留键，且绝不碰现存设置", () => {
    localStorage.setItem(LEGACY, '{"blur":0,"scrim":0.41,"scale":1.06}');
    localStorage.setItem("imagora.surface-transparency.v1", "1");
    localStorage.setItem("imagora.accent-hue.v1", "224");
    localStorage.setItem("imagora.background-preset.v1", "mist");
    localStorage.setItem("imagora.canvas-bounds.v1", "1");

    purgeLegacyWallpaperSettings();

    expect(localStorage.getItem(LEGACY)).toBeNull();
    // 现存设置一个都不能少（若用 localStorage.clear() 就会在这里挂掉）
    expect(localStorage.getItem("imagora.surface-transparency.v1")).toBe("1");
    expect(localStorage.getItem("imagora.accent-hue.v1")).toBe("224");
    expect(localStorage.getItem("imagora.background-preset.v1")).toBe("mist");
    expect(localStorage.getItem("imagora.canvas-bounds.v1")).toBe("1");
  });

  it("幂等：重复调用安全，键该没还是没", () => {
    localStorage.setItem(LEGACY, "{}");
    expect(() => {
      purgeLegacyWallpaperSettings();
      purgeLegacyWallpaperSettings();
    }).not.toThrow();
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });

  it("键本来就不存在时不抛错", () => {
    expect(() => purgeLegacyWallpaperSettings()).not.toThrow();
  });
});

describe("IndexedDB 不可用时安静降级", () => {
  it("读：返回 null（= 没有壁纸）", async () => {
    await expect(readWallpaperImage()).resolves.toBeNull();
  });

  it("写：返回 false（调用方据此提示未设置）", async () => {
    await expect(saveWallpaperImage(new Blob(["x"], { type: "image/png" }))).resolves.toBe(false);
  });

  it("删：正常 resolve，不抛错", async () => {
    await expect(clearWallpaperImage()).resolves.toBeUndefined();
  });

  it("全局不存在 indexedDB 时（最老环境）也安静返回", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      await expect(readWallpaperImage()).resolves.toBeNull();
      await expect(saveWallpaperImage(new Blob(["x"]))).resolves.toBe(false);
      await expect(clearWallpaperImage()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("open 阶段出问题也必须降级", () => {
  it("indexedDB.open 直接抛异常时（被策略阻断），三个函数仍安静返回", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("被策略阻断");
      },
    });
    try {
      await expect(readWallpaperImage()).resolves.toBeNull();
      await expect(saveWallpaperImage(new Blob(["x"]))).resolves.toBe(false);
      await expect(clearWallpaperImage()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("open 请求触发 onerror 时，读返回 null、写返回 false、删正常 resolve", async () => {
    // 替身：把 openDatabase 赋进来的 onerror 异步触发一次，模拟「打开失败」
    const failingRequest = () => {
      const request: { onerror?: ((event: Event) => void) | null } = {};
      setTimeout(() => request.onerror?.(new Event("error")), 0);
      return request;
    };
    vi.stubGlobal("indexedDB", { open: () => failingRequest() });
    try {
      await expect(readWallpaperImage()).resolves.toBeNull();
      await expect(saveWallpaperImage(new Blob(["x"]))).resolves.toBe(false);
      await expect(clearWallpaperImage()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("open 请求触发 onblocked 时也降级（升级被别的标签页挡住）", async () => {
    const blockedRequest = () => {
      const request: { onblocked?: ((event: Event) => void) | null } = {};
      setTimeout(() => request.onblocked?.(new Event("blocked")), 0);
      return request;
    };
    vi.stubGlobal("indexedDB", { open: () => blockedRequest() });
    try {
      await expect(readWallpaperImage()).resolves.toBeNull();
      await expect(saveWallpaperImage(new Blob(["x"]))).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
