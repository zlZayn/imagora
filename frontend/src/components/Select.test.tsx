// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Select } from "./Select";

const options = [
  { value: "a", label: "选项 A" },
  { value: "b", label: "选项 B" },
  { value: "c", label: "选项 C" },
];

describe("Select", () => {
  afterEach(cleanup);

  it("展示当前值并用鼠标选择", () => {
    const onChange = vi.fn();
    render(<Select options={options} value="a" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /选项 A/ });
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "选项 B" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("方向键移动活动项，Enter 选择并归还焦点", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<Select options={options} value="a" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /选项 A/ });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-1");
    fireEvent.keyDown(trigger, { key: "Enter" });
    vi.runAllTimers();
    expect(onChange).toHaveBeenCalledWith("b");
    expect(trigger).toBe(document.activeElement);
    vi.useRealTimers();
  });

  it("Home 和 End 跳转首尾，Escape 不改变值", () => {
    const onChange = vi.fn();
    render(<Select options={options} value="b" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /选项 B/ });
    fireEvent.keyDown(trigger, { key: "End" });
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-2");
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(trigger.getAttribute("aria-activedescendant")).toContain("option-0");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("Tab 与外部点击关闭列表", () => {
    render(<Select options={options} value="a" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /选项 A/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("暴露 option 选中语义，并容忍空选项和未知值", () => {
    const { rerender } = render(<Select options={options} value="b" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /选项 B/ }));
    expect(screen.getByRole("option", { name: "选项 B" }).getAttribute("aria-selected")).toBe("true");
    rerender(<Select options={[]} value="missing" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /请选择/ });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
