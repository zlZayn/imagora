# -*- coding: utf-8 -*-
"""画布核心交互回归（E2E，Playwright）

覆盖：新建/上传落点在视口中心、视口不突变、右键菜单屏蔽、预览打开/点击空白关闭。

前置：本地服务已启动（uv run python -m main ui --port 7860），且已安装：
  pip install playwright && playwright install chromium

运行：python frontend/e2e/verify_canvas.py
"""
import base64
import glob
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:7860"

# 1x1 PNG（用于上传，避免依赖 output/.canvas 里的真实图片）
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def vp_snap(page):
    """当前视口快照：zoom + 视口中心对应的 flow 坐标。
    flow = (相对视口容器的屏幕坐标 - vx) / zoom；容器 rect 从 (0,0) 起算。"""
    return page.evaluate("""() => {
      const vp = document.querySelector(".react-flow__viewport");
      const rf = document.querySelector(".react-flow");
      if (!vp || !rf) return null;
      const m = new DOMMatrix(getComputedStyle(vp).transform);
      const rect = rf.getBoundingClientRect();
      return {
        zoom: m.a, vx: m.e, vy: m.f,
        centerX: (rect.width / 2 - m.e) / m.a,
        centerY: (rect.height / 2 - m.f) / m.a,
      };
    }""")


def node_pos(page, type_):
    return page.evaluate("""(type_) => {
      const node = document.querySelector(".react-flow__node-" + type_);
      if (!node) return null;
      const m = new DOMMatrix(getComputedStyle(node).transform);
      return { x: m.e, y: m.f };
    }""", type_)


results = []
def check(name, ok, detail=""):
    print(("PASS" if ok else "FAIL") + " | " + name + ((" | " + detail) if detail else ""))
    results.append((name, ok))


def main():
    # 自包含测试图片：写临时文件，通过 file chooser 上传
    tmp_img = os.path.join(tempfile.gettempdir(), "imagora_e2e_pixel.png")
    with open(tmp_img, "wb") as f:
        f.write(base64.b64decode(PNG_B64))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.on("dialog", lambda d: d.dismiss())  # 自动拒绝画布恢复存档询问
        page.goto(BASE + "/?mode=canvas&win=e2e")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)

        # contextmenu 监测：document 冒泡层记录"事件到达且未被 preventDefault"
        page.evaluate("""() => {
          window.__ctxProbe = [];
          document.addEventListener("contextmenu", (e) => {
            window.__ctxProbe.push({ reached: true, defaultPrevented: e.defaultPrevented });
          });
        }""")

        # 1. 新建提示词卡片：位置 = 创建时视口中心，且视口不突变
        before = vp_snap(page)
        page.get_by_role("button", name="新建提示词卡片").click()
        page.wait_for_timeout(250)
        after = vp_snap(page)
        pos = node_pos(page, "prompt")
        if before and after and pos:
            dx = abs(pos["x"] - before["centerX"]); dy = abs(pos["y"] - before["centerY"])
            check("新建提示词卡片=视口中心", dx < 2 and dy < 2,
                  f"node=({pos["x"]:.1f},{pos["y"]:.1f}) center=({before["centerX"]:.1f},{before["centerY"]:.1f})")
            check("新建后视口不突变", abs(after["zoom"] - before["zoom"]) < 0.01,
                  f"zoom {before["zoom"]:.3f}->{after["zoom"]:.3f}")
        else:
            check("新建提示词卡片=视口中心", False, f"before={before} after={after} pos={pos}")

        # 2. 新建图片组：阶梯 +30，仍在中心附近
        page.get_by_role("button", name="新建图片组").click()
        page.wait_for_timeout(250)
        gpos = node_pos(page, "group")
        center2 = vp_snap(page)
        if gpos and center2:
            dx = abs(gpos["x"] - center2["centerX"]); dy = abs(gpos["y"] - center2["centerY"])
            check("新建图片组在中心附近(阶梯<=40px)", dx < 40 and dy < 40,
                  f"node=({gpos["x"]:.1f},{gpos["y"]:.1f}) center=({center2["centerX"]:.1f},{center2["centerY"]:.1f})")
        else:
            check("新建图片组在中心附近", False, f"gpos={gpos}")

        # 3. 上传图片：落在视口中心附近（阶梯），视口不突变
        with page.expect_file_chooser() as fc_info:
            page.get_by_role("button", name="上传图片").click()
        fc = fc_info.value
        fc.set_files(tmp_img)
        page.wait_for_timeout(1500)
        ipos = node_pos(page, "image")
        center3 = vp_snap(page)
        if ipos and center3:
            dx = abs(ipos["x"] - center3["centerX"]); dy = abs(ipos["y"] - center3["centerY"])
            check("上传图片在中心附近(阶梯<=80px)", dx < 80 and dy < 80,
                  f"node=({ipos["x"]:.1f},{ipos["y"]:.1f}) center=({center3["centerX"]:.1f},{center3["centerY"]:.1f})")
            check("上传后视口不突变", abs(center3["zoom"] - center2["zoom"]) < 0.01,
                  f"zoom {center2["zoom"]:.3f}->{center3["zoom"]:.3f}")
        else:
            check("上传图片在中心附近", False, f"ipos={ipos} center={center3}")

        # 4. 右键拖拽出画布（拖到工具栏上方）松开：菜单被屏蔽
        page.evaluate("window.__ctxProbe = []")
        box = page.locator(".react-flow").first.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
        page.mouse.down(button="right")
        page.mouse.move(box["x"] + box["width"] * 0.8, max(20, box["y"] - 60), steps=5)
        page.mouse.up(button="right")
        page.wait_for_timeout(400)
        probe = page.evaluate("window.__ctxProbe")
        leaked = [e for e in probe if e["reached"] and not e["defaultPrevented"]]
        check("右键拖出画布松开：菜单被屏蔽", len(leaked) == 0, f"probe={probe}")

        # 5. 画布内右键单击：菜单被屏蔽
        page.evaluate("window.__ctxProbe = []")
        cx = box["x"] + box["width"] * 0.3
        cy = box["y"] + box["height"] * 0.3
        page.mouse.click(cx, cy, button="right")
        page.wait_for_timeout(300)
        probe = page.evaluate("window.__ctxProbe")
        leaked = [e for e in probe if e["reached"] and not e["defaultPrevented"]]
        check("画布内右键单击：菜单被屏蔽", len(leaked) == 0, f"probe={probe}")

        # 6. 双击图片 → 预览出现 → 点击空白处关闭
        page.locator(".react-flow__node-image img").first.dblclick()
        page.wait_for_timeout(700)
        modal = page.locator("img[data-zoom-image]")
        check("双击图片打开预览", modal.count() == 1)
        if modal.count() == 1:
            vp = page.viewport_size
            page.mouse.click(round(vp["width"] * 0.02), round(vp["height"] * 0.08))
            page.wait_for_timeout(400)
            check("预览点击空白处关闭", modal.count() == 0)

        # 7. 放大后（zoom>1）点图片边缘空白也应关闭（历史 bug：放大态点击被拖拽拦截）
        page.locator(".react-flow__node-image img").first.dblclick()
        page.wait_for_timeout(700)
        if page.locator("img[data-zoom-image]").count() == 1:
            # 滚轮放大
            vp = page.viewport_size
            page.mouse.move(round(vp["width"] / 2), round(vp["height"] / 2))
            page.mouse.wheel(0, -400)
            page.wait_for_timeout(300)
            geom = page.evaluate("""() => {
              const img = document.querySelector("img[data-zoom-image]");
              const b = img.getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height };
            }""")
            # 点图片右侧边缘外 20px（仍在图片容器内）
            page.mouse.click(round(geom["x"] + geom["w"] + 20), round(geom["y"] + geom["h"] / 2))
            page.wait_for_timeout(400)
            check("放大后点击图片边缘空白关闭", page.locator("img[data-zoom-image]").count() == 0)

        browser.close()

    failed = [n for n, ok in results if not ok]
    print()
    print(f"TOTAL: {len(results)}  PASS: {len(results) - len(failed)}  FAIL: {len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())