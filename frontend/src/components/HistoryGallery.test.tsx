// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HistoryGallery } from "./HistoryGallery";
import { generationHistory, type GenerationHistoryItem } from "../api";

// 历史记录走后端 API，jsdom 无真实后端，mock 掉网络层
vi.mock("../api", () => ({
  generationHistory: vi.fn(),
  openFolder: vi.fn(),
}));

function item(overrides: Partial<GenerationHistoryItem> = {}): GenerationHistoryItem {
  return {
    time: "2026-08-25 10:00",
    mode: "txt2img",
    refs: 0,
    prompt: "一只猫在窗台上晒太阳",
    size: "1024x1024",
    quality: "high",
    status: "ok",
    exists: true,
    path: "C:/out/2026-08-25/a.png",
    url: "http://x/a.png",
    inputRefs: [],
    ...overrides,
  };
}

function renderList(list: GenerationHistoryItem[], hasMore = false) {
  vi.mocked(generationHistory).mockResolvedValue({ items: list, hasMore });
  return render(<HistoryGallery open onClose={vi.fn()} onImport={vi.fn()} />);
}

/**
 * 回归测试：生成历史面板改版为「紧凑单列列表视图」后，
 * 行内全文字按钮 / 参考图固定宽区换行 / 提示词截断浮层（仅截断时弹）的渲染契约。
 */
describe("HistoryGallery 列表视图", () => {
  afterEach(() => {
    cleanup(); // 无 globals 注入时不自动清理，显式清 DOM 防跨用例文本撞车
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染行内全要素：全文字按钮、提示词+元信息、参考图小图区", async () => {
    renderList([
      item({
        inputRefs: [
          { id: "r1", path: "p1", url: "http://x/r1.png" },
          { id: "r2", path: "p2", url: "http://x/r2.png" },
        ],
      }),
    ]);
    await screen.findByText("复制提示词");

    // 按钮列：全文字，导入用 btn-primary 语义可不管，重点在文案齐全
    expect(screen.getByText("复制提示词")).toBeTruthy();
    expect(screen.getByText("打开目录")).toBeTruthy();
    expect(screen.getByText("导入当前画布")).toBeTruthy();
    // 提示词 + 元信息
    expect(screen.getByText("一只猫在窗台上晒太阳")).toBeTruthy();
    expect(screen.getByText("2026-08-25 10:00 · high · 1024x1024")).toBeTruthy();
    // 参考图区：固定宽区里 2 张 24px 小图 + 1 张结果缩略图
    expect(screen.getAllByAltText("参考图")).toHaveLength(2);
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("纯文生图无参考图：参考图区留空且无琥珀提示", async () => {
    renderList([item({ inputRefs: [] })]);
    await screen.findByText("复制提示词");
    expect(screen.queryByAltText("参考图")).toBeNull();
    expect(screen.queryByText("参考图缺失")).toBeNull();
  });

  it("图生图记录但参考图找不回：显示琥珀「参考图缺失」提示", async () => {
    renderList([item({ inputRefs: [], inputRefMissing: true })]);
    await screen.findByText("复制提示词");
    expect(screen.getByText("参考图缺失")).toBeTruthy();
  });

  it("结果图缺失：error 显示生成失败、其余显示文件已移动", async () => {
    renderList([
      item({ url: "", status: "error", prompt: "失败记录" }),
      item({ url: "", status: "ok", prompt: "被移动记录", path: "C:/out/b.png", output: "b.png" }),
    ]);
    expect(await screen.findByText("生成失败")).toBeTruthy();
    expect(screen.getByText("文件已移动")).toBeTruthy();
  });

  it("提示词浮层：仅当 2 行真被截断时弹出，并跟随鼠标、离开消失", async () => {
    const longPrompt = "一只戴蓝色围巾的橘猫趴在窗台".repeat(6); // 超长必截断
    renderList([item({ prompt: longPrompt })]);
    await screen.findByText("复制提示词");

    const line = screen.getByText(longPrompt);
    // jsdom 中 scrollHeight===clientHeight 恒为 0，2 行截断判定恒 false；人为制造纵向溢出
    Object.defineProperty(line, "scrollHeight", { configurable: true, value: 200 });
    Object.defineProperty(line, "clientHeight", { configurable: true, value: 48 });

    fireEvent.mouseEnter(line, { clientX: 100, clientY: 100 });
    const tip = screen.getByTestId("prompt-tip") as HTMLElement;
    expect(tip).toBeTruthy();
    // 宽固定屏幕 80% 且水平居中（左/右各留 10vw），不随鼠标水平移动
    expect(tip.style.width).toBe("80vw");
    expect(tip.style.left).toBe("10vw");
    // 垂直跟随鼠标 y（clamp 视口）
    expect(tip.style.top).toBe("116px");
    fireEvent.mouseMove(line, { clientX: 300, clientY: 200 });
    const moved = screen.getByTestId("prompt-tip") as HTMLElement;
    expect(moved.style.left).toBe("10vw"); // 水平保持居中
    expect(moved.style.top).toBe("216px"); // 垂直跟随到新 y

    fireEvent.mouseLeave(line);
    expect(screen.queryByTestId("prompt-tip")).toBeNull();
  });

  it("提示词未截断：hover 不弹多余浮层", async () => {
    renderList([item({ prompt: "短提示词" })]);
    await screen.findByText("复制提示词");

    const line = screen.getByText("短提示词");
    fireEvent.mouseEnter(line, { clientX: 100, clientY: 100 });
    expect(screen.queryByTestId("prompt-tip")).toBeNull();
  });
});

describe("HistoryGallery 分页（滚动加载）", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("首屏加载第 0 页；点「加载更多」按已加载条数追加下一页", async () => {
    const page1 = Array.from({ length: 60 }, (_, i) => item({ prompt: `第一页卡片 ${i}` }));
    const page2 = Array.from({ length: 6 }, (_, i) => item({ prompt: `第二页卡片 ${i}` }));
    vi.mocked(generationHistory)
      .mockResolvedValueOnce({ items: page1, hasMore: true })
      .mockResolvedValueOnce({ items: page2, hasMore: false });

    render(<HistoryGallery open onClose={vi.fn()} onImport={vi.fn()} />);

    expect(await screen.findByText("第一页卡片 0")).toBeTruthy();
    expect(screen.queryByText("第二页卡片 0")).toBeNull(); // 未加载时不渲染
    expect(generationHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0, limit: 60 }));

    fireEvent.click(screen.getByText("加载更多"));
    expect(await screen.findByText("第二页卡片 0")).toBeTruthy();
    expect(generationHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 60, limit: 60 }));
    expect(screen.getByText("已显示全部记录")).toBeTruthy(); // hasMore=false
  });

  it("搜索重置分页：重新从第 0 页拉取，不保留旧页数据", async () => {
    vi.mocked(generationHistory)
      .mockResolvedValueOnce({ items: [item({ prompt: "旧结果" })], hasMore: false })
      .mockResolvedValueOnce({ items: [item({ prompt: "匹配喵" })], hasMore: false });

    render(<HistoryGallery open onClose={vi.fn()} onImport={vi.fn()} />);
    await screen.findByText("旧结果");

    const input = screen.getByPlaceholderText("搜索提示词、质量或文件名");
    fireEvent.change(input, { target: { value: "喵" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("匹配喵")).toBeTruthy();
    expect(screen.queryByText("旧结果")).toBeNull();
    expect(generationHistory).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, query: "喵" }));
  });

  it("状态筛选立即重载并从第 0 页开始", async () => {
    vi.mocked(generationHistory)
      .mockResolvedValueOnce({ items: [item({ prompt: "全量记录" })], hasMore: false })
      .mockResolvedValueOnce({ items: [item({ prompt: "仅失败记录", status: "error" })], hasMore: false });

    render(<HistoryGallery open onClose={vi.fn()} onImport={vi.fn()} />);
    await screen.findByText("全量记录");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "error" } });

    expect(await screen.findByText("仅失败记录")).toBeTruthy();
    expect(screen.queryByText("全量记录")).toBeNull();
    expect(generationHistory).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, status: "error" }));
  });

  it("滚动接近底部自动追加下一页（无需点按钮）", async () => {
    const page1 = Array.from({ length: 60 }, (_, i) => item({ prompt: `滚动页 1 卡片 ${i}` }));
    const page2 = Array.from({ length: 6 }, (_, i) => item({ prompt: `滚动页 2 卡片 ${i}` }));
    vi.mocked(generationHistory)
      .mockResolvedValueOnce({ items: page1, hasMore: true })
      .mockResolvedValueOnce({ items: page2, hasMore: false });

    render(<HistoryGallery open onClose={vi.fn()} onImport={vi.fn()} />);
    await screen.findByText("滚动页 1 卡片 0");

    const list = screen.getByTestId("history-list");
    // jsdom 无滚动布局，手动构造"接近底部 600px 内"的几何数据再触发 scroll
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 1500 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 300 });
    fireEvent.scroll(list);

    expect(await screen.findByText("滚动页 2 卡片 0")).toBeTruthy();
    expect(screen.queryByText("加载更多")).toBeNull(); // 已加载完，按钮态消失
    expect(generationHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 60 }));
  });

  it("远离底部滚动不触发翻页", async () => {
    vi.mocked(generationHistory).mockResolvedValue({ items: [item({ prompt: "仅一页" })], hasMore: true });
    render(<HistoryGallery open onClose={vi.fn()} onImport={vi.fn()} />);
    await screen.findByText("仅一页");

    const list = screen.getByTestId("history-list");
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 100 }); // 距底 4600px
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 300 });
    fireEvent.scroll(list);

    // scroll 触发不请求；仅 mock 首屏调用
    expect(generationHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText("加载更多")).toBeTruthy(); // 按钮仍在
  });
});
