import { describe, expect, it } from "vitest";

import { clampPreviewPan, clampZoom, ZOOM_MAX, ZOOM_MIN } from "./previewZoom";

describe("clampZoom", () => {
  it("clamps to the configured range", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(2)).toBe(2);
  });
});

describe("clampPreviewPan", () => {
  const box = { width: 1000, height: 600 };
  const viewport = { width: 800, height: 500 };

  it("allows free pan when scaled size fits the viewport (clamps to 0)", () => {
    // zoom=0.5: 500x300 < viewport -> 不允许平移
    expect(clampPreviewPan({ x: 500, y: 300 }, 0.5, box, viewport)).toEqual({ x: 0, y: 0 });
  });

  it("clamps pan so the image center stays within the viewport", () => {
    // zoom=2: 2000x1200，中心对称夹紧 (2000-800)/2=600, (1200-500)/2=350
    expect(clampPreviewPan({ x: 9999, y: -9999 }, 2, box, viewport)).toEqual({ x: 600, y: -350 });
    expect(clampPreviewPan({ x: 0, y: 0 }, 2, box, viewport)).toEqual({ x: 0, y: 0 });
  });

  it("keeps an already-valid pan untouched", () => {
    expect(clampPreviewPan({ x: 200, y: -100 }, 2, box, viewport)).toEqual({ x: 200, y: -100 });
  });

  it("returns the pan unchanged before the image is measured", () => {
    expect(clampPreviewPan({ x: 50, y: 50 }, 1.5, { width: 0, height: 0 }, viewport)).toEqual({ x: 50, y: 50 });
  });
});
