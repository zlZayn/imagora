"""从 favicon.svg 生成「启动生图工作台.ico」：透明底 + 灰黑线条。

做法与取舍：

- 图形沿用 [favicon.svg](../frontend/public/favicon.svg)（**不改动原文件**），只替换填充色；
- 用 `getBBox()` 取图形紧致边界重设 viewBox，裁掉四周留白——否则小尺寸下图形偏小；
- 每个尺寸单独让浏览器渲染（缩放质量优于图像库重采样），再按 ICO 规范打包（PNG 嵌入，Vista+ 支持）；
- 不引入新依赖：渲染用项目已有的 playwright，打包用标准库 `struct`。

用法（项目根目录，可选传输出路径）：

    .\\.venv\\Scripts\\python.exe scripts\\make_icon.py
    .\\.venv\\Scripts\\python.exe scripts\\make_icon.py %TEMP%\\preview.ico
"""

import struct
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "frontend" / "public" / "favicon.svg"
OUT = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else Path(__file__).resolve().parent / "启动生图工作台.ico"
)

SOURCE_FILL = "#475569"  # favicon.svg 当前填充色（改动时这里会报错提醒）
INK = "#17202b"  # 图标线条色：项目正文文字色，灰黑
PAD_RATIO = 0.07  # 图形四周留白（相对图形最大边）
SIZES = (16, 24, 32, 48, 64, 128, 256)


def render(page, svg_markup: str, side: int, path: Path) -> None:
    html = (
        "<html><head><style>html,body{margin:0;padding:0;background:transparent}"
        f"svg{{display:block;width:{side}px;height:{side}px}}</style></head><body>"
        f"{svg_markup}</body></html>"
    )
    page.set_content(html)
    page.screenshot(path=str(path), omit_background=True)


def build_ico(frames: list[tuple[int, bytes]]) -> bytes:
    """ICO 容器：宽高字段 256 按规范写 0；每帧直接嵌 PNG。"""
    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries = bytearray()
    payload = bytearray()
    for side, png in frames:
        dim = 0 if side >= 256 else side
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        payload += png
        offset += len(png)
    return bytes(header + entries + payload)


def main() -> None:
    svg_source = SVG.read_text(encoding="utf-8")
    if SOURCE_FILL not in svg_source:
        raise SystemExit(
            f"favicon.svg 中未找到 {SOURCE_FILL}，填充色可能已变，请人工确认"
        )

    work = Path(tempfile.gettempdir()) / "imagora-icon-frames"
    work.mkdir(exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 512, "height": 512})

        # 1) 紧致边界：正方形取景，图形居中
        page.set_content(svg_source)
        box = page.evaluate(
            "() => { const b = document.querySelector('svg').getBBox();"
            " return { x: b.x, y: b.y, w: b.width, h: b.height }; }"
        )
        cx, cy = box["x"] + box["w"] / 2, box["y"] + box["h"] / 2
        half = max(box["w"], box["h"]) / 2 * (1 + PAD_RATIO)
        view_box = f"{cx - half:.2f} {cy - half:.2f} {2 * half:.2f} {2 * half:.2f}"

        # 2) 换色 + 换取景框（源文件保持不变）
        tinted = svg_source.replace(SOURCE_FILL, INK).replace("0 0 1024 1024", view_box)
        if view_box not in tinted:
            raise SystemExit("viewBox 未替换成功，请检查 favicon.svg 的 viewBox 写法")

        # 3) 逐尺寸渲染透明 PNG
        frames: list[tuple[int, bytes]] = []
        for side in SIZES:
            page.set_viewport_size({"width": side, "height": side})
            png_path = work / f"icon-{side}.png"
            render(page, tinted, side, png_path)
            frames.append((side, png_path.read_bytes()))
            print(f"  rendered {side:>3}px  {png_path.stat().st_size:>6} bytes")

        browser.close()

    OUT.write_bytes(build_ico(frames))
    print(f"bbox={box}")
    print(f"viewBox={view_box}")
    print(f"ICO -> {OUT}  ({OUT.stat().st_size} bytes, sizes={list(SIZES)})")


if __name__ == "__main__":
    main()
