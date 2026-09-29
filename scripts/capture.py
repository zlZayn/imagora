"""生成本地 UI 审计截图到 `_ui-audit/`（项目根目录下，该目录已被 git 忽略，不进仓库）。

覆盖经典表单、画布、各模态与滚动条；文件名按 `NN-用途.png` 排序。
运行前需 7860 服务已启动（项目根目录）：

    .\\.venv\\Scripts\\python.exe -m main ui --no-browser --port 7860

然后（项目根目录）：`.\\.venv\\Scripts\\python.exe scripts\\capture.py`
脚本会先清空输出目录的旧 png 再重新生成；默认只写 `_ui-audit/`，`--out` 可换目录。
"""

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:7860"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "_ui-audit"
VIEW = {"width": 1500, "height": 950}
SCALE = 2

shots: list[tuple[str, int, str]] = []


def shot(out: Path, page, name: str, note: str, selector: str | None = None) -> None:
    """整页截图；给了 selector 就只截该元素。"""
    path = out / name
    if selector:
        page.locator(selector).screenshot(path=str(path))
    else:
        page.screenshot(path=str(path))
    shots.append((name, path.stat().st_size, note))


def dismiss(page) -> None:
    """点遮罩左上角关闭模态（各模态关闭按钮/快捷键不统一，点遮罩最稳）。"""
    page.mouse.click(10, 10)
    page.wait_for_timeout(400)


def parse_args() -> Path:
    """输出目录；相对路径按项目根解析（默认 `_ui-audit/`）。"""
    parser = argparse.ArgumentParser(
        description="生成本地 UI 审计截图（需 7860 服务已启动）"
    )
    parser.add_argument(
        "--out", default=str(DEFAULT_OUT), help="输出目录（默认 _ui-audit/）"
    )
    args = parser.parse_args()
    out = Path(args.out)
    return out if out.is_absolute() else ROOT / out


def main() -> None:
    out = parse_args()
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()

    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport=VIEW, device_scale_factor=SCALE)
        page.goto(f"{BASE}/?win=1", wait_until="networkidle")
        page.wait_for_timeout(1000)

        # 经典表单
        shot(out, page, "01-classic-form.png", "经典表单全景：左三卡 + 右结果区")
        shot(out, page, "02-header.png", "顶栏：控件等高基线 + 角标", ".studio-header")
        shot(out, page, "03-brand.png", "品牌区：logo 3D 挤出", ".brand-swing")

        # 生图 API 设置（看 / 改 / 管 三页）
        page.get_by_role("button", name="生图 API").click()
        page.wait_for_timeout(600)
        for tab, name, note in (
            ("使用中", "04-modal-api-usage.png", "API 设置 · 使用中：生效值 + 来源"),
            ("个人配置", "05-modal-api-edit.png", "API 设置 · 个人配置：表单"),
            ("预设", "06-modal-api-presets.png", "API 设置 · 预设：列表管理"),
        ):
            page.get_by_role("tab", name=tab).click()
            page.wait_for_timeout(600)
            shot(out, page, name, note)
        dismiss(page)

        # 无限画布 + 三个画布模态
        page.get_by_role("button", name="无限画布").click()
        page.wait_for_timeout(1600)
        shot(out, page, "07-canvas.png", "无限画布全景")
        for button, name, note in (
            ("加载工作流", "08-modal-workflow-load.png", "画布 · 加载工作流"),
            ("保存工作流", "09-modal-workflow-save.png", "画布 · 保存工作流"),
            ("粘贴导入", "10-modal-prompt-import.png", "画布 · 粘贴导入提示词"),
        ):
            page.get_by_role("button", name=button).click()
            page.wait_for_timeout(600)
            shot(out, page, name, note)
            dismiss(page)

        # 生成历史（含成本看板）
        page.get_by_role("button", name="生成历史").click()
        page.wait_for_timeout(1300)
        shot(out, page, "11-history.png", "生成历史 + 成本看板")
        dismiss(page)
        b.close()

        # 矮视口：紧凑高度下的布局（页面会出现滚动条；headless 不绘制滚动条本身，
        # 要看待滚动条的真实外观需在有头浏览器里看）
        b2 = p.chromium.launch()
        small = b2.new_page(
            viewport={"width": VIEW["width"], "height": 620}, device_scale_factor=SCALE
        )
        small.goto(f"{BASE}/?win=1", wait_until="networkidle")
        small.wait_for_timeout(1000)
        shot(
            out,
            small,
            "12-narrow-height.png",
            "紧凑高度下的经典表单（页面级滚动条生效时）",
        )
        b2.close()

    print(f"生成 {len(shots)} 张 -> {out}")
    for name, size, note in shots:
        print(f"  {name:<32} {size:>9}  {note}")


if __name__ == "__main__":
    main()
