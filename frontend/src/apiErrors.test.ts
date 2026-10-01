// 回归：改动后端代码后忘记重启服务时，接口会返回 405（请求掉进静态文件挂载）。
// 这个错误码对用户完全不可读，api.ts 必须把它翻译成「服务端是旧版本，请重启」。
import { afterEach, describe, expect, it, vi } from "vitest";

import { rememberOutputDir } from "./api";

/** 伪造一个 fetch Response（不依赖 Response 构造函数，jsdom 下更稳） */
function fakeResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("接口错误提示", () => {
  it("405 翻译成人话：提示服务端是旧版本并让用户重启", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(405, '{"detail":"Method Not Allowed"}')),
    );

    await expect(rememberOutputDir("C:/tmp")).rejects.toThrow(/旧版本/);
    await expect(rememberOutputDir("C:/tmp")).rejects.toThrow(/重新打开/);
  });

  it("405 之外的错误码保持原始信息（不误伤真实的上游报错）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(401, '{"detail":"Invalid API key"}')),
    );

    await expect(rememberOutputDir("C:/tmp")).rejects.toThrow(/HTTP 401/);
    await expect(rememberOutputDir("C:/tmp")).rejects.not.toThrow(/旧版本/);
  });
});
