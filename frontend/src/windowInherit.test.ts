// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearInheritedState,
  readInheritedState,
  saveInheritedState,
  type InheritedRef,
} from "./windowInherit";

const KEY = "aig-window-inherit";

const ref: InheritedRef = { path: "output/.refs/a.png", name: "a.png", size: 1234, ext: "png" };

function writeRaw(value: unknown): void {
  sessionStorage.setItem(KEY, JSON.stringify(value));
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("saveInheritedState → readInheritedState", () => {
  it("写进去的状态能被原样读回，且不清除（清除时机归调用方）", () => {
    const result = saveInheritedState([ref], "1024x1024", "high", "output");
    expect(result).toEqual({ ok: true, filesIncluded: true });
    expect(readInheritedState()).toEqual({
      refs: [ref],
      size: "1024x1024",
      quality: "high",
      outputDir: "output",
    });
  });

  it("notice 省略时不写这个键（而不是写成 undefined）", () => {
    saveInheritedState([ref], "512x512", "standard", "output");
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "{}")).not.toHaveProperty("notice");
    saveInheritedState([ref], "512x512", "standard", "output", "2 张参考图未上传成功");
    expect(readInheritedState()?.notice).toBe("2 张参考图未上传成功");
  });

  it("参考图为空时 ok 仍为真，filesIncluded 为假", () => {
    expect(saveInheritedState([], "1024x1024", "high", "output")).toEqual({
      ok: true,
      filesIncluded: false,
    });
  });

  it("sessionStorage 整体不可用时放弃继承，不抛错", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(saveInheritedState([ref], "1024x1024", "high", "output")).toEqual({
      ok: false,
      filesIncluded: false,
    });
  });
});

describe("readInheritedState 的形状校验", () => {
  it("没有该键 → 无继承（命令行或直接输 URL 打开的新窗口）", () => {
    expect(readInheritedState()).toBeNull();
    sessionStorage.setItem(KEY, "");
    expect(readInheritedState()).toBeNull();
  });

  it("非 JSON 内容 → 无继承，不抛错", () => {
    sessionStorage.setItem(KEY, "<html>报错页</html>");
    expect(readInheritedState()).toBeNull();
  });

  it("顶层形状不符 → 无继承", () => {
    writeRaw([ref]);
    expect(readInheritedState()).toBeNull();
    writeRaw({ size: "1024x1024", quality: "high", outputDir: "output" });
    expect(readInheritedState()).toBeNull();
  });

  it("refs 元素字段类型不符 → 整份判为无继承（不部分信任）", () => {
    writeRaw({ refs: [{ path: "a", name: "a.png", size: "12", ext: "png" }], size: "s", quality: "q", outputDir: "o" });
    expect(readInheritedState()).toBeNull();
  });

  it("notice 只接受字符串，别的类型判为无继承", () => {
    writeRaw({ refs: [], size: "s", quality: "q", outputDir: "o", notice: 42 });
    expect(readInheritedState()).toBeNull();
  });
});

describe("clearInheritedState", () => {
  it("清除后读不回，且不影响其他键", () => {
    sessionStorage.setItem("other", "1");
    saveInheritedState([ref], "1024x1024", "high", "output");
    clearInheritedState();
    expect(readInheritedState()).toBeNull();
    expect(sessionStorage.getItem("other")).toBe("1");
  });
});
