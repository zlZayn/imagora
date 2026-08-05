#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FastAPI 后端 —— API 路由 + 托管前端构建产物

启动: uv run python -m main ui（http://127.0.0.1:7860）

API:
  GET  /api/config          尺寸/质量选项、默认输出路径、Key 状态
  POST /api/select-folder   弹出系统文件夹选择器，返回路径
  POST /api/open-folder     资源管理器打开文件夹（置前）
  POST /api/generate        文生图 / 图生图（multipart）
  GET  /api/image?path=     读取生成的图片文件
"""
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from core.api import format_error, generate_image
from core.config import DEFAULT_OUTPUT_DIR, WORK_ROOT, get_api_key
from core.logging import log_generation


class NoCacheMiddleware(BaseHTTPMiddleware):
    """静态资源禁用缓存：本地迭代频繁，保证页面总是最新"""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-cache"
        return response

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DIST_DIR = FRONTEND_DIR / "dist"

# 尺寸选项：分辨率 / 显示标签 / 单张费用（元）
SIZE_OPTIONS = [
    {"value": "1024x1024", "label": "1024x1024 (1:1 1K)", "cost": 0.05},
    {"value": "1024x1536", "label": "1024x1536 (2:3 竖版)", "cost": 0.10},
    {"value": "1536x1024", "label": "1536x1024 (3:2 横版)", "cost": 0.10},
    {"value": "1152x2048", "label": "1152x2048 (9:16 竖版长图)", "cost": 0.10},
    {"value": "2048x1152", "label": "2048x1152 (16:9 横版)", "cost": 0.10},
    {"value": "1024x1792", "label": "1024x1792 (竖版长图)", "cost": 0.10},
    {"value": "1792x1024", "label": "1792x1024 (横版长图)", "cost": 0.10},
]
QUALITY_OPTIONS = ["low", "medium", "high"]

app = FastAPI(title="A站生图工具")
app.add_middleware(NoCacheMiddleware)


def has_api_key() -> bool:
    """API Key 是否已配置（用于界面提示）"""
    try:
        get_api_key()
        return True
    except RuntimeError:
        return False


@app.get("/api/config")
def get_config():
    """前端初始化配置"""
    return {
        "sizes": SIZE_OPTIONS,
        "qualities": QUALITY_OPTIONS,
        "defaultOutputDir": DEFAULT_OUTPUT_DIR,
        "hasApiKey": has_api_key(),
    }


@app.post("/api/select-folder")
def select_folder(body: dict):
    """弹出系统文件夹选择器；取消则返回原路径"""
    current = str(body.get("current", ""))
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="选择输出文件夹")
        root.destroy()
        return {"path": folder if folder else current}
    except Exception:
        return {"path": current}


def size_cost(size: str) -> float:
    """按尺寸查单张费用；未知尺寸按 2K 档 0.10 兜底"""
    for option in SIZE_OPTIONS:
        if option["value"] == size:
            return option["cost"]
    return 0.10


def display_path(path: str) -> str:
    """路径展示：相对工作根 + 统一正斜杠，便于阅读"""
    try:
        rel = os.path.relpath(path, WORK_ROOT)
    except ValueError:
        rel = path
    return rel.replace("\\", "/")


@app.post("/api/generate")
async def generate(prompt: str = Form(...), size: str = Form("1024x1024"),
                   quality: str = Form("low"), output_dir: str = Form(""),
                   images: list[UploadFile] = File(default=[])):
    """文生图 / 图生图。有 images 时多张参考图一次提交（用途由提示词决定），否则文生图。

    每个结果带尺寸与费用；响应含本次成功张数的总费用。
    """
    out_dir = (output_dir.strip() or DEFAULT_OUTPUT_DIR).rstrip("\\/")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    started_at = time.time()
    cost = size_cost(size)
    results = []
    messages = []

    if images:
        dest = os.path.join(out_dir, f"img2img_{stamp}.png")
        messages.append(f"图生图 · 参考图 {len(images)} 张")
        temp_bases = []
        try:
            # 底图先落临时文件，结果写到输出目录
            for image in images:
                with tempfile.NamedTemporaryFile(
                    suffix=Path(image.filename or "img").suffix or ".png", delete=False
                ) as tmp:
                    tmp.write(await image.read())
                    temp_bases.append(tmp.name)
            generate_image(
                prompt=prompt, images=temp_bases, size=size,
                quality=quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": image_url(dest), "size": size, "cost": cost})
            messages.append(f"已保存 · {display_path(dest)}（{size}）")
        except Exception as e:
            results.append({"status": "error", "message": format_error(e)})
            messages.append(f"失败 · {format_error(e)}")
        finally:
            for tmp in temp_bases:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
    else:
        dest = os.path.join(out_dir, f"txt2img_{stamp}.png")
        messages.append("文生图")
        try:
            generate_image(
                prompt=prompt, image_path=None, size=size,
                quality=quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": image_url(dest), "size": size, "cost": cost})
            messages.append(f"已保存 · {display_path(dest)}（{size}）")
        except Exception as e:
            results.append({"status": "error", "message": format_error(e)})
            messages.append(f"失败 · {format_error(e)}")

    total_cost = sum(r.get("cost", 0) for r in results if r.get("status") == "ok")
    ok_count = sum(1 for r in results if r.get("status") == "ok")
    messages.append(f"本次成功 {ok_count} 张 · 费用 {total_cost:.2f} 元")

    ok = results and results[0].get("status") == "ok"
    log_generation(
        prompt=prompt,
        mode="img2img" if images else "txt2img",
        refs=len(images),
        size=size,
        quality=quality,
        status="ok" if ok else "error",
        output=dest if ok else "",
        cost=total_cost,
        seconds=time.time() - started_at,
    )
    return {"results": results, "messages": messages, "totalCost": total_cost}


@app.post("/api/open-folder")
def open_folder(body: dict):
    """在系统资源管理器中打开指定文件夹，并尝试激活到前台

    后台进程启动的 explorer 窗口默认不抢前台（Windows 前台锁定），
    这里用 Win32 API 在打开后主动把窗口置前。
    """
    path = str(body.get("path", "")).rstrip("\\/")
    try:
        os.makedirs(path, exist_ok=True)
        subprocess.Popen(["explorer.exe", path])
        time.sleep(1.0)
        _activate_explorer_window(os.path.basename(path) or path)
        return {"ok": True}
    except Exception:
        return {"ok": False}


def _activate_explorer_window(title_part: str) -> bool:
    """把标题包含 title_part 的资源管理器窗口恢复并置前（绕过前台锁定）"""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _lparam):
        cls = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, cls, 256)
        if cls.value in ("CabinetWClass", "ExplorerWClass"):
            title = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, title, 512)
            if title_part in title.value:
                found.append(hwnd)
        return True

    user32.EnumWindows(callback, 0)
    if not found:
        return False

    hwnd = found[0]
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    # 绕过前台锁定：模拟一次 Alt 键按下/抬起，再置前
    user32.keybd_event(0x12, 0, 0, 0)  # ALT down
    user32.SetForegroundWindow(hwnd)
    user32.keybd_event(0x12, 0, 2, 0)  # ALT up
    user32.BringWindowToTop(hwnd)
    return True


def image_url(path: str) -> str:
    """生成可访问图片文件的相对 URL"""
    return f"/api/image?path={quote(path)}"


@app.get("/api/image")
def get_image(path: str):
    """读取生成的图片文件"""
    abs_path = os.path.abspath(path)
    if not os.path.isfile(abs_path):
        return JSONResponse({"error": "文件不存在"}, status_code=404)
    return FileResponse(abs_path)


# 静态托管前端构建产物（挂在最后，仅当 dist 已构建）
if (DIST_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="frontend")
else:
    @app.get("/", include_in_schema=False)
    def frontend_not_built():
        """前端未构建时的提示页（错误放 UI，不静默空白）"""
        return HTMLResponse(
            "<h3>前端未构建</h3>"
            "<p>请先在 tools 目录执行：</p>"
            "<pre>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</pre>"
            "<p>构建完成后刷新本页。详见 README「快速开始」。</p>",
            status_code=503,
        )
