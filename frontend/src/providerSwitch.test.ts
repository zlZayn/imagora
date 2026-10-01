import { describe, expect, it } from "vitest";

import { applyProviderToForm, type ApiFormLike, type ProviderLike } from "./providerSwitch";

/** 切换服务来源时的表单规则：核心是「跨来源必须清空 Key」。 */

const DOUBAO: ProviderLike = {
  id: "doubao",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiPath: "/images/generations",
  model: "doubao-seedream-5-0-pro-260628",
};

const WANWU: ProviderLike = {
  id: "wanwu",
  baseUrl: "https://2api.aiwanwu.cc",
  apiPath: "/v1/images/generations",
  model: "gpt-image-2",
};

const EMPTY: ApiFormLike = { baseUrl: "", apiKey: "", model: "", apiPath: "" };

const WITH_ARK_KEY: ApiFormLike = {
  baseUrl: DOUBAO.baseUrl,
  apiKey: "ark-0c8668ee-fc58",
  model: DOUBAO.model,
  apiPath: DOUBAO.apiPath,
};

describe("切换服务来源", () => {
  it("空 → 选来源：带出地址/路径/模型", () => {
    const got = applyProviderToForm(EMPTY, DOUBAO, "");
    expect(got.baseUrl).toBe(DOUBAO.baseUrl);
    expect(got.apiPath).toBe(DOUBAO.apiPath);
    expect(got.model).toBe(DOUBAO.model);
  });

  it("空 → 选来源：保留用户可能已手填的 Key", () => {
    const got = applyProviderToForm({ ...EMPTY, apiKey: "手填的-key" }, DOUBAO, "");
    expect(got.apiKey).toBe("手填的-key");
  });

  it("豆包 → wanwu：清空 Key（两套 Key 不通用）", () => {
    const got = applyProviderToForm(WITH_ARK_KEY, WANWU, "doubao");
    expect(got.apiKey).toBe("");
    expect(got.baseUrl).toBe(WANWU.baseUrl);
    expect(got.model).toBe(WANWU.model);
  });

  it("wanwu → 豆包：同样清空 Key", () => {
    const wanwuForm: ApiFormLike = {
      baseUrl: WANWU.baseUrl,
      apiKey: "sk-3147386d",
      model: WANWU.model,
      apiPath: WANWU.apiPath,
    };
    const got = applyProviderToForm(wanwuForm, DOUBAO, "wanwu");
    expect(got.apiKey).toBe("");
  });

  it("重复点同一来源：保留 Key（无操作，不误清）", () => {
    const got = applyProviderToForm(WITH_ARK_KEY, DOUBAO, "doubao");
    expect(got.apiKey).toBe("ark-0c8668ee-fc58");
  });

  it("传入 null：表单原样返回", () => {
    const got = applyProviderToForm(WITH_ARK_KEY, null, "doubao");
    expect(got).toEqual(WITH_ARK_KEY);
  });
});
