#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FastAPI 后端 —— API 路由 + 托管前端构建产物

启动: uv run python -m main ui（http://127.0.0.1:7860）

API:
  GET  /api/config          尺寸/质量选项、默认输出路径
  POST /api/select-folder   弹出系统文件夹选择器，返回路径
  POST /api/generate        文生图 / 图生图（multipart）
  GET  /api/image?path=     读取生成的图片文件
"""
import os
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from core.api import format_error, generate_image
from core.config import DEFAULT_OUTPUT_DIR, WORK_ROOT

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


@app.get("/api/config")
def get_config():
    """前端初始化配置"""
    return {"sizes": SIZE_OPTIONS, "qualities": QUALITY_OPTIONS, "defaultOutputDir": DEFAULT_OUTPUT_DIR}


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
    """文生图 / 图生图。有 images 时逐张图生图，否则文生图。

    每个结果带尺寸与费用；响应含本次成功张数的总费用。
    """
    out_dir = (output_dir.strip() or DEFAULT_OUTPUT_DIR).rstrip("\\/")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    cost = size_cost(size)
    results = []
    messages = []

    if images:
        for i, image in enumerate(images):
            ext = Path(image.filename or f"img_{i}").suffix or ".png"
            dest = os.path.join(out_dir, f"img2img_{stamp}_{i}.png")
            messages.append(f"[{i + 1}/{len(images)}] 图生图 · 底图 {image.filename}")
            try:
                # 底图先落临时文件，结果写到输出目录
                with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                    tmp.write(await image.read())
                    base_image = tmp.name
                generate_image(
                    prompt=prompt, image_path=base_image, size=size,
                    quality=quality, output_format="png", output_path=dest,
                )
                os.unlink(base_image)
                results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": image_url(dest), "size": size, "cost": cost})
                messages.append(f"已保存 · {display_path(dest)}（{size}）")
            except Exception as e:
                results.append({"status": "error", "message": format_error(e)})
                messages.append(f"失败 · {format_error(e)}")
            time.sleep(3)
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
    return {"results": results, "messages": messages, "totalCost": total_cost}


@app.post("/api/open-folder")
def open_folder(body: dict):
    """在系统资源管理器中打开指定文件夹（不存在则自动创建）"""
    path = str(body.get("path", "")).rstrip("\\/")
    try:
        os.makedirs(path, exist_ok=True)
        os.startfile(path)  # Windows
        return {"ok": True}
    except Exception:
        return {"ok": False}


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
