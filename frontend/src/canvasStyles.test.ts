import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

describe("canvas connection styles", () => {
  it("keeps stable handle geometry so edges remain aligned at every zoom", () => {
    expect(css).toContain("width: 32px");
    expect(css).toContain("height: 12px");
    expect(css).not.toContain("calc(32px / var(--canvas-zoom, 1))");
    expect(css).not.toContain("calc(12px / var(--canvas-zoom, 1))");
    expect(css).not.toMatch(/react-flow__handle-(?:top|bottom)[\s\S]{0,160}scale\(/);
  });

  it("uses the active window brand for the temporary connection", () => {
    expect(css).toMatch(/react-flow__connection-path[\s\S]*stroke: var\(--color-brand\)/);
    expect(css).not.toMatch(/react-flow__connection-path[\s\S]*#ef4444/);
  });
});

describe("canvas node enter/exit animations", () => {
  it("animates the inner .node-pop card, never the positioning wrapper", () => {
    expect(css).toMatch(/\.react-flow__node\.node-enter \.node-pop\s*\{[^}]*animation:/);
    expect(css).toMatch(/\.react-flow__node\.node-exiting \.node-pop\s*\{[^}]*animation:/);
    // 外层只做类选择器，不允许给 .react-flow__node 自身设置 transform（会与 React Flow 定位冲突）
    expect(css).not.toMatch(/\.react-flow__node\.node-enter\s*\{[^}]*transform/);
    expect(css).not.toMatch(/\.react-flow__node\.node-exiting\s*\{[^}]*transform/);
  });

  it("stagger delays apply to the inner card via descendant selectors", () => {
    for (const n of [1, 2, 3]) {
      expect(css).toMatch(new RegExp(`\\.react-flow__node\\.node-enter\\.enter-delay-${n} \\.node-pop\\s*\\{[^}]*animation-delay`));
    }
  });
});
