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
import ctypes
import itertools
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import Body, FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from core.api import format_error, generate_image
from core.config import DEFAULT_OUTPUT_DIR, WORK_ROOT, get_api_key
from core.logging import log_generation

# 多开窗口：服务端原子分配递增编号（GIL 保证并发安全）
_WIN_COUNTER = itertools.count(1)
# 生成文件名全局序号：秒级时间戳同秒并发必撞，加序号保证唯一
_SEQ = itertools.count(1)
# 参考图缓存：前端「添加即上传」落盘于此，跨窗口只传路径引用（不占浏览器存储配额）
REF_DIR = os.path.join(DEFAULT_OUTPUT_DIR, ".refs")
# 参考图文件名全局序号
_REF_SEQ = itertools.count(1)
# 参考图孤儿文件最长保留时长（前端删除失败 / 上传未用的情况兜底清理）
REF_MAX_AGE_SECONDS = 24 * 3600
# 上次输出路径记录：服务重启后默认沿用（无记录才按窗口分区）
LAST_OUTPUT_DIR_FILE = os.path.join(DEFAULT_OUTPUT_DIR, ".last_output_dir")
# 串行化有界面副作用的系统调用（tkinter 选择器、explorer 置前）
_UI_LOCK = threading.Lock()


def load_last_output_dir() -> str | None:
    """读取上次使用的输出路径（跨服务重启记住）；无记录 / 读取失败返回 None"""
    try:
        with open(LAST_OUTPUT_DIR_FILE, encoding="utf-8") as f:
            path = f.read().strip()
            return path or None
    except OSError:
        return None


def save_last_output_dir(path: str) -> None:
    """记录上次使用的输出路径（下次启动默认沿用）；记录失败不影响生成"""
    try:
        os.makedirs(os.path.dirname(LAST_OUTPUT_DIR_FILE), exist_ok=True)
        with open(LAST_OUTPUT_DIR_FILE, "w", encoding="utf-8") as f:
            f.write(path)
    except OSError:
        pass


def safe_ref_path(path: str) -> str | None:
    """仅接受 REF_DIR 内的绝对路径（防路径穿越）；非法返回 None"""
    abs_path = os.path.abspath(path)
    ref_root = os.path.abspath(REF_DIR)
    if os.path.commonpath([abs_path, ref_root]) != ref_root:
        return None
    return abs_path


def cleanup_stale_refs(max_age_seconds: int = REF_MAX_AGE_SECONDS) -> None:
    """清理 REF_DIR 中超时的孤儿参考图（服务启动时调用一次）"""
    if not os.path.isdir(REF_DIR):
        return
    now = time.time()
    for name in os.listdir(REF_DIR):
        p = os.path.join(REF_DIR, name)
        try:
            if now - os.path.getmtime(p) > max_age_seconds:
                os.unlink(p)
        except OSError:
            pass


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

# 启动时清理超时的孤儿参考图（前端删除失败 / 上传未用的情况兜底）
cleanup_stale_refs()


def has_api_key() -> bool:
    """API Key 是否已配置（用于界面提示）"""
    try:
        get_api_key()
        return True
    except RuntimeError:
        return False


@app.get("/api/config")
def get_config(win: int | None = None):
    """前端初始化配置。

    多开页面：前端传已有窗口号（URL ?win= 或 window.name 记忆）则沿用，
    否则服务端原子分配下一个编号；默认输出目录按窗口分区 output/win{N}。
    """
    window_id = win if win and win > 0 else next(_WIN_COUNTER)
    # 默认输出路径：优先记住的上次路径（服务重启沿用），无记录才按窗口分区
    last_dir = load_last_output_dir()
    default_dir = last_dir or os.path.join(DEFAULT_OUTPUT_DIR, f"win{window_id}")
    return {
        "sizes": SIZE_OPTIONS,
        "qualities": QUALITY_OPTIONS,
        "defaultOutputDir": default_dir,
        "hasApiKey": has_api_key(),
        "windowId": window_id,
    }


@app.get("/api/window/next")
def next_window():
    """分配下一个窗口编号（多开脚本 / 界面按钮用，与 /api/config 共用计数器，全局唯一）"""
    return {"windowId": next(_WIN_COUNTER)}


@app.post("/api/upload-ref")
def upload_ref(images: list[UploadFile] = File(default=[])):
    """参考图落盘 output/.refs/，返回元信息供前端渲染与跨窗口继承。

    前端「添加进上传区时」即调用：大图不走 sessionStorage（5MB 配额），
    继承/生成只引用返回的 path，一次上传多处复用。
    """
    os.makedirs(REF_DIR, exist_ok=True)
    refs = []
    for image in images:
        data = image.file.read()
        ext = (Path(image.filename or "img").suffix or ".png").lower()
        name = f"ref_{int(time.time())}_{next(_REF_SEQ):04d}{ext}"
        dest = os.path.join(REF_DIR, name)
        with open(dest, "wb") as f:
            f.write(data)
        refs.append({
            "id": name,
            "path": dest,
            "url": image_url(dest),
            "name": image.filename or name,
            "size": len(data),
            "ext": ext.lstrip("."),
            "mime": image.content_type or "application/octet-stream",
        })
    return {"refs": refs}


@app.post("/api/delete-ref")
def delete_ref(path: str = Body(..., embed=True)):
    """删除已落盘参考图（尽力而为，文件不存在也算成功）"""
    abs_path = safe_ref_path(path)
    if abs_path:
        try:
            os.unlink(abs_path)
        except OSError:
            pass
    return {"ok": True}


@app.post("/api/select-folder")
def select_folder(body: dict):
    """弹出系统文件夹选择器；取消则返回原路径

    多窗口并发调用 tkinter 会触发 Tcl 线程错误，用 _UI_LOCK 串行化
    （对话框是模态的，用户同一时刻只会操作一个，锁不会阻塞正常使用）。
    """
    current = str(body.get("current", ""))
    try:
        with _UI_LOCK:
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
def generate(prompt: str = Form(...), size: str = Form("1024x1024"),
             quality: str = Form("low"), output_dir: str = Form(""),
             images: list[UploadFile] = File(default=[]),
             ref_paths: str = Form(""),
             win: int = Form(0)):
    """文生图 / 图生图。图生图二选一：ref_paths（JSON 字符串数组，引用已上传参考图，优先）
    或 images（未上传的本地兜底，落临时文件）；都不传即文生图。

    每个结果带尺寸/费用/文件大小/后缀；响应含本次成功张数的总费用。
    文件名带全局序号：多窗口同秒并发生成互不覆盖。
    同步 def：走 FastAPI 线程池，生成期间不阻塞事件循环，其他请求（开新窗口/加载页面）照常响应。
    """
    out_dir = (output_dir.strip() or DEFAULT_OUTPUT_DIR).rstrip("\\/")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    started_at = time.time()
    cost = size_cost(size)
    results = []
    messages = []

    # ref_paths 解析（JSON 字符串数组）；非法直接返回错误，不进入生成
    ref_list: list[str] = []
    if ref_paths:
        try:
            ref_list = json.loads(ref_paths)
        except json.JSONDecodeError:
            results.append({"status": "error", "message": "参考图参数非法"})
            messages.append("失败 · 参考图参数非法")
            messages.append("本次成功 0 张 · 费用 0.00 元")
            log_generation(
                prompt=prompt, mode="img2img", refs=0, size=size, quality=quality,
                status="error", output="", cost=0.0,
                seconds=time.time() - started_at, win=win or None,
            )
            return {"results": results, "messages": messages, "totalCost": 0.0}

    ref_bases: list[str] = []   # 已落盘参考图（持久缓存，不清理）
    temp_bases: list[str] = []  # multipart 上传的临时文件（生成后清理）
    try:
        if ref_list:
            # 复用已上传参考图：只接受 REF_DIR 内路径，防路径穿越
            for p in ref_list:
                safe = safe_ref_path(p)
                if not safe or not os.path.isfile(safe):
                    raise ValueError(f"非法参考图路径: {p}")
                ref_bases.append(safe)
            seq = next(_SEQ)
            dest = os.path.join(out_dir, f"img2img_{stamp}_{seq:03d}.png")
            messages.append(f"图生图 · 参考图 {len(ref_bases)} 张")
            generate_image(
                prompt=prompt, images=ref_bases, size=size,
                quality=quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": image_url(dest), "size": size, "cost": cost, "fileSize": os.path.getsize(dest), "ext": Path(dest).suffix.lstrip(".")})
            messages.append(f"已保存 · {display_path(dest)}（{size}）")
        elif images:
            # 未上传的本地兜底：底图先落临时文件，结果写到输出目录
            seq = next(_SEQ)
            dest = os.path.join(out_dir, f"img2img_{stamp}_{seq:03d}.png")
            messages.append(f"图生图 · 参考图 {len(images)} 张")
            for image in images:
                with tempfile.NamedTemporaryFile(
                    suffix=Path(image.filename or "img").suffix or ".png", delete=False
                ) as tmp:
                    tmp.write(image.file.read())
                    temp_bases.append(tmp.name)
            generate_image(
                prompt=prompt, images=temp_bases, size=size,
                quality=quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": image_url(dest), "size": size, "cost": cost, "fileSize": os.path.getsize(dest), "ext": Path(dest).suffix.lstrip(".")})
            messages.append(f"已保存 · {display_path(dest)}（{size}）")
        else:
            seq = next(_SEQ)
            dest = os.path.join(out_dir, f"txt2img_{stamp}_{seq:03d}.png")
            messages.append("文生图")
            generate_image(
                prompt=prompt, image_path=None, size=size,
                quality=quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": image_url(dest), "size": size, "cost": cost, "fileSize": os.path.getsize(dest), "ext": Path(dest).suffix.lstrip(".")})
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

    total_cost = sum(r.get("cost", 0) for r in results if r.get("status") == "ok")
    ok_count = sum(1 for r in results if r.get("status") == "ok")
    messages.append(f"本次成功 {ok_count} 张 · 费用 {total_cost:.2f} 元")

    # 记住本次输出路径：下次服务启动默认沿用（生成失败不算"用过"）
    if ok_count > 0:
        save_last_output_dir(out_dir)

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
        win=win or None,
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
        # 串行化：多窗口并发打开文件夹时避免 explorer 置前互相抢前台
        with _UI_LOCK:
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
