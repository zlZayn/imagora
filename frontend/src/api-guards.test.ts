import { describe, expect, it } from "vitest";

import { isAppConfig, isHistoryResponse } from "./api-guards";

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sizes: [{ value: "1024x1024", label: "1:1", cost: 1 }],
    qualities: ["high"],
    defaultOutputDir: "output",
    windowId: 1,
    ...overrides,
  };
}

function historyItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { exists: true, path: "a.png", url: "/api/image?path=a.png", ...overrides };
}

describe("isAppConfig", () => {
  it("accepts a well-formed config (可选字段缺失也合法)", () => {
    expect(isAppConfig(config())).toBe(true);
    expect(isAppConfig({ ...config(), baseUrl: "http://x", activeProfile: "default" })).toBe(true);
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, "x", 1, []]) {
      expect(isAppConfig(bad)).toBe(false);
    }
  });

  it("rejects a wrong-typed required field", () => {
    expect(isAppConfig(config({ defaultOutputDir: 1 }))).toBe(false);
    expect(isAppConfig(config({ windowId: "1" }))).toBe(false);
    expect(isAppConfig(config({ qualities: [1] }))).toBe(false);
  });

  it("rejects a malformed sizes entry (缺 cost)", () => {
    expect(isAppConfig(config({ sizes: [{ value: "1:1", label: "1:1" }] }))).toBe(false);
    expect(isAppConfig(config({ sizes: "1024" }))).toBe(false);
  });

  it("passes unknown extra keys through (后端加字段不该让前端报错)", () => {
    expect(isAppConfig({ ...config(), futureField: { nested: true } })).toBe(true);
  });
});

describe("isHistoryResponse", () => {
  it("accepts a well-formed response (含 inputRefs 与可选字段)", () => {
    expect(isHistoryResponse({ items: [historyItem()], hasMore: false })).toBe(true);
    expect(
      isHistoryResponse({
        items: [
          historyItem({
            status: "done",
            cost: 0.12,
            inputRefs: [{ id: "r1", path: "r.png", url: "/api/image?path=r.png" }],
          }),
        ],
        hasMore: true,
      }),
    ).toBe(true);
  });

  it("rejects a malformed envelope (items 非数组 / hasMore 缺失)", () => {
    expect(isHistoryResponse({ items: {}, hasMore: false })).toBe(false);
    expect(isHistoryResponse({ items: [], hasMore: "no" })).toBe(false);
    expect(isHistoryResponse({ items: [] })).toBe(false);
  });

  it("rejects an item with a missing required field", () => {
    expect(isHistoryResponse({ items: [historyItem({ path: undefined })], hasMore: false })).toBe(false);
    expect(isHistoryResponse({ items: [{ exists: true, url: "u" }], hasMore: false })).toBe(false);
  });

  it("rejects an item whose optional field is present but wrongly typed", () => {
    expect(isHistoryResponse({ items: [historyItem({ status: 200 })], hasMore: false })).toBe(false);
    expect(isHistoryResponse({ items: [historyItem({ cost: "0.1" })], hasMore: false })).toBe(false);
    expect(isHistoryResponse({ items: [historyItem({ inputRefs: [{ id: "r1" }] })], hasMore: false })).toBe(false);
  });
});
