// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { readPersonalApiPresets, savePersonalApiPresets } from "./api";
import type { PersonalApiPreset } from "./types";

/** 「我的接口」记录读写：localStorage 往返 + lastUsed 保留 + 去重键的稳定性 */

function entry(overrides: Partial<PersonalApiPreset> = {}): PersonalApiPreset {
  return {
    id: "id-1",
    name: "豆包 Seedream · doubao-seedream-5-0-pro-260628",
    settings: {
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "ark-abc123",
      model: "doubao-seedream-5-0-pro-260628",
      apiPath: "/images/generations",
    },
    ...overrides,
  };
}

describe("我的接口 记录", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("save -> read 往返保留 lastUsed", () => {
    const ts = Date.now();
    savePersonalApiPresets([entry({ lastUsed: ts })]);
    const got = readPersonalApiPresets();
    expect(got).toHaveLength(1);
    expect(got[0]?.lastUsed).toBe(ts);
    expect(got[0]?.settings.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
  });

  it("无 lastUsed 的旧数据仍可读（向后兼容）", () => {
    savePersonalApiPresets([entry()]);
    const got = readPersonalApiPresets();
    expect(got).toHaveLength(1);
    expect(got[0]?.lastUsed).toBeUndefined();
  });

  it("最近使用置顶：按 lastUsed 倒序排列", () => {
    const older = entry({ id: "a", lastUsed: 1000 });
    const newer = entry({
      id: "b",
      lastUsed: 2000,
      settings: { ...entry().settings, baseUrl: "https://2api.aiwanwu.cc" },
    });
    savePersonalApiPresets([older, newer]);
    const sorted = [...readPersonalApiPresets()].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
    expect(sorted[0]?.id).toBe("b");
    expect(sorted[1]?.id).toBe("a");
  });

  it("去重键（baseUrl|model|apiKey）能区分不同来源", () => {
    const doubao = entry();
    const wanwu = entry({
      id: "id-2",
      settings: {
        baseUrl: "https://2api.aiwanwu.cc",
        apiKey: "sk-xyz",
        model: "gpt-image-2",
        apiPath: "/v1/images/generations",
      },
    });
    const key = (p: PersonalApiPreset) =>
      `${p.settings.baseUrl}|${p.settings.model}|${p.settings.apiKey}`;
    expect(key(doubao)).not.toBe(key(wanwu));
  });
});
