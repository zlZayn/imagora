import { describe, expect, it } from "vitest";

import type { GenerationHistoryItem } from "./api";
import { RERUN_LOST_REFS, groupSkipReasons, planRerun, rerunBlockReason, toBatchItems } from "./rerun";

function item(overrides: Partial<GenerationHistoryItem> = {}): GenerationHistoryItem {
  return {
    time: "2026-08-25 10:00",
    mode: "txt2img",
    refs: 0,
    prompt: "一只猫",
    size: "1024x1024",
    quality: "high",
    status: "error",
    exists: false,
    path: "",
    url: "",
    inputRefs: [],
    ...overrides,
  };
}

describe("rerunBlockReason 可重跑判定", () => {
  it("成功记录不重跑", () => {
    expect(rerunBlockReason(item({ status: "ok" }))).toBe("不是失败记录");
  });

  it("缺提示词 / 尺寸 / 质量分别给出原因", () => {
    expect(rerunBlockReason(item({ prompt: "   " }))).toBe("提示词为空");
    expect(rerunBlockReason(item({ size: "" }))).toBe("缺少尺寸");
    expect(rerunBlockReason(item({ quality: "" }))).toBe("缺少质量");
  });

  it("图生图记录参考图找不回 → 明确报丢失（不静默降级成文生图）", () => {
    expect(rerunBlockReason(item({ mode: "img2img", refs: 5, inputRefs: [] }))).toBe(RERUN_LOST_REFS);
    expect(rerunBlockReason(item({ refs: 2, inputRefs: [{ id: "a", path: "", url: "" }] }))).toBe(RERUN_LOST_REFS);
  });

  it("参考图仍在（注册表解析出 absolute path）→ 可重跑", () => {
    expect(rerunBlockReason(item({
      mode: "img2img", refs: 2, inputRefs: [{ id: "a", path: "out/.assets/canv_a.png", url: "/api/image?a" }],
    }))).toBeNull();
  });

  it("纯文生图失败记录可直接重跑", () => {
    expect(rerunBlockReason(item({ mode: "txt2img", refs: 0 }))).toBeNull();
  });
});

describe("planRerun 分组", () => {
  it("可重跑与跳过分开，并单独统计参考图丢失数", () => {
    const items = [
      item({ time: "1", mode: "img2img", refs: 1, inputRefs: [{ id: "a", path: "p/a.png", url: "u" }] }),
      item({ time: "2", mode: "img2img", refs: 5 }),
      item({ time: "3", mode: "txt2img" }),
      item({ time: "4", status: "ok" }),
      item({ time: "5", size: "" }),
    ];
    const plan = planRerun(items);
    expect(plan.runnable.map((r) => r.time)).toEqual(["1", "3"]);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.lostRefs).toBe(1);
  });

  it("空列表安全", () => {
    expect(planRerun([])).toEqual({ runnable: [], skipped: [], lostRefs: 0 });
  });
});

describe("toBatchItems 构造批量提交参数", () => {
  it("只带注册表解析出的参考图绝对路径（空 path 丢弃）", () => {
    const items = toBatchItems([
      item({
        prompt: "p1", size: "1152x2048", quality: "high",
        inputRefs: [
          { id: "a", path: "out/.assets/canv_a.png", url: "u1" },
          { id: "b", path: "", url: "u2" },
        ],
      }),
    ]);
    expect(items).toEqual([
      { prompt: "p1", size: "1152x2048", quality: "high", refPaths: ["out/.assets/canv_a.png"] },
    ]);
  });
});

describe("groupSkipReasons 原因聚合", () => {
  it("同原因合并且按条数倒序", () => {
    const grouped = groupSkipReasons([
      { item: item(), reason: RERUN_LOST_REFS },
      { item: item(), reason: "缺少尺寸" },
      { item: item(), reason: RERUN_LOST_REFS },
    ]);
    expect(grouped).toEqual([
      { reason: RERUN_LOST_REFS, count: 2 },
      { reason: "缺少尺寸", count: 1 },
    ]);
  });
});
