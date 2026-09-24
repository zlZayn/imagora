import { describe, expect, it } from "vitest";

import { errMessage, formatBytes, generatingLabel } from "./format";

describe("formatBytes", () => {
  it("按 B / KB / MB 三档切换，边界落在 1024 的整倍数", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("KB 与 MB 保留一位小数", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("generatingLabel", () => {
  it("把已用秒数拼成生成中文案", () => {
    expect(generatingLabel(0)).toBe("生成中 0s");
    expect(generatingLabel(12)).toBe("生成中 12s");
  });
});

describe("errMessage", () => {
  it("Error 取 message，非 Error 转字符串", () => {
    expect(errMessage(new Error("上游 500"))).toBe("上游 500");
    expect(errMessage("纯文本失败")).toBe("纯文本失败");
    expect(errMessage({ status: 422 })).toBe("[object Object]");
  });

  it("超长才截断并补省略号，limit 可覆盖", () => {
    const long = "x".repeat(130);
    expect(errMessage(long)).toBe(`${"x".repeat(120)}…`);
    expect(errMessage(long, 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("恰好等于上限不截断（边界不吞字符）", () => {
    const exact = "y".repeat(120);
    expect(errMessage(exact)).toBe(exact);
  });
});
