import { describe, expect, it } from "vitest";

import { pickRecentPrompts } from "./recentPrompts";

describe("pickRecentPrompts", () => {
  it("按入参顺序取（越靠前越新），保持原顺序", () => {
    const out = pickRecentPrompts([{ prompt: "第一条" }, { prompt: "第二条" }, { prompt: "第三条" }]);
    expect(out).toEqual(["第一条", "第二条", "第三条"]);
  });

  it("同一条提示词反复重跑只算一次，保留最靠前的那次", () => {
    const out = pickRecentPrompts([
      { prompt: "高精度3D半写实国漫女性角色四视图" },
      { prompt: "天宫玄武" },
      { prompt: "高精度3D半写实国漫女性角色四视图" },
    ]);
    expect(out).toEqual(["高精度3D半写实国漫女性角色四视图", "天宫玄武"]);
  });

  it("只在前 40 字之后不同的近似版本会被归并，保留最新的那条", () => {
    const head = "高精度3D半写实国漫女性角色四视图设定图，成年年轻女性，法式复古、油色系与现代熟风融合";
    const newer = `${head}，气质优雅`;
    const older = `${head}，气质温柔而内敛`;
    const out = pickRecentPrompts([{ prompt: newer }, { prompt: older }, { prompt: "天宫玄武" }]);
    expect(out).toEqual([newer, "天宫玄武"]);
  });

  it("前 40 字不同则视为两条不同提示词", () => {
    const a = "高精度3D半写实国漫女性角色四视图设定图，成年年轻女性，法式复古、油色系与现代熟风";
    const b = "天宫玄武，北天镇界神兽，龟蛇合体，极强巨物感，超低机位仰视，广角构图，玄武本体独立";
    const out = pickRecentPrompts([{ prompt: a }, { prompt: b }]);
    expect(out).toEqual([a, b]);
  });

  it("归并键会归一空白：同一串词只差空格数量时视为同一条", () => {
    const a = "一个红色苹果 白色背景 商品摄影 柔和侧光";
    const b = "一个红色苹果   白色背景  商品摄影 柔和侧光";
    const out = pickRecentPrompts([{ prompt: b }, { prompt: a }]);
    expect(out).toEqual([b]);
  });

  it("丢弃空白与缺失的提示词", () => {
    const out = pickRecentPrompts([
      { prompt: "有效" },
      { prompt: "   " },
      {},
      { prompt: "" },
      { prompt: "也有效" },
    ]);
    expect(out).toEqual(["有效", "也有效"]);
  });

  it("首尾空白会被裁剪后再去重", () => {
    const out = pickRecentPrompts([{ prompt: "  苹果  " }, { prompt: "苹果" }]);
    expect(out).toEqual(["苹果"]);
  });

  it("受 limit 限制，且取到 limit 条即停止", () => {
    const out = pickRecentPrompts(
      [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }],
      2,
    );
    expect(out).toEqual(["a", "b"]);
  });

  it("空入参返回空数组", () => {
    expect(pickRecentPrompts([])).toEqual([]);
  });

  it("去重后不足 limit 时返回全部", () => {
    const out = pickRecentPrompts([{ prompt: "唯一一条" }], 5);
    expect(out).toEqual(["唯一一条"]);
  });
});
