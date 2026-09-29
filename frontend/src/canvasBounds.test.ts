// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANVAS_BOUNDS_STORAGE_KEY, readCanvasBounds, saveCanvasBounds } from "./canvasBounds";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("readCanvasBounds", () => {
  it("未设置时默认显示边界（保持既有观感）", () => {
    expect(readCanvasBounds()).toBe(true);
  });

  it("空白值当未设置", () => {
    localStorage.setItem(CANVAS_BOUNDS_STORAGE_KEY, "   ");
    expect(readCanvasBounds()).toBe(true);
  });

  it("存过关闭就一直是关闭（刷新后仍在）", () => {
    saveCanvasBounds(false);
    expect(readCanvasBounds()).toBe(false);
  });

  it("存过开启读作开启", () => {
    saveCanvasBounds(true);
    expect(readCanvasBounds()).toBe(true);
  });

  it("兼容手写的 1 / true / 0 / false", () => {
    localStorage.setItem(CANVAS_BOUNDS_STORAGE_KEY, "1");
    expect(readCanvasBounds()).toBe(true);
    localStorage.setItem(CANVAS_BOUNDS_STORAGE_KEY, "true");
    expect(readCanvasBounds()).toBe(true);
    localStorage.setItem(CANVAS_BOUNDS_STORAGE_KEY, "0");
    expect(readCanvasBounds()).toBe(false);
    localStorage.setItem(CANVAS_BOUNDS_STORAGE_KEY, "false");
    expect(readCanvasBounds()).toBe(false);
  });

  it("非法值（乱码 / 非布尔词）当未设置，回落默认开启", () => {
    localStorage.setItem(CANVAS_BOUNDS_STORAGE_KEY, "yes-please");
    expect(readCanvasBounds()).toBe(true);
  });

  it("localStorage 不可用时回落默认值 true，不抛错", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readCanvasBounds()).toBe(true);
  });
});

describe("saveCanvasBounds", () => {
  it("写入可被读回，且是紧凑标记（0 / 1）", () => {
    saveCanvasBounds(false);
    expect(localStorage.getItem(CANVAS_BOUNDS_STORAGE_KEY)).toBe("0");
    saveCanvasBounds(true);
    expect(localStorage.getItem(CANVAS_BOUNDS_STORAGE_KEY)).toBe("1");
  });

  it("localStorage 不可用时静默降级，不抛错", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveCanvasBounds(false)).not.toThrow();
  });
});
