// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HistoryGallery from "./HistoryGallery";
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

function renderList(list: GenerationHistoryItem[]) {
  vi.mocked(generationHistory).mockResolvedValue({ items: list });
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
