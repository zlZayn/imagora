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
