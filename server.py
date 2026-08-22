#!/usr/bin/env python3
"""FastAPI 后端 —— API 路由 + 托管前端构建产物

启动: uv run python -m main ui（http://127.0.0.1:7860）

API:
  GET  /api/config                    初始化配置（尺寸/质量/默认输出路径/窗口号）
  GET  /api/health/details            启动自检（Key / 前端构建 / 输出可写）
  GET  /api/window/next               分配下一个窗口编号
  GET  /api/history                   生成历史（limit/query/status 筛选）
  POST /api/history/import            历史结果导入画布
  POST /api/upload-ref                参考图落盘 output/.refs/
  POST /api/delete-ref                删除已落盘参考图
  POST /api/output-dir                记住输出路径（重启沿用）
  POST /api/generate                  文生图 / 图生图（multipart）
  POST /api/select-folder             弹出系统文件夹选择器
  POST /api/open-folder               资源管理器打开文件夹（置前）
  GET  /api/image?path=               读取图片文件
  POST /api/canvas/upload             画布图片上传（复制进 output/.canvas/）
  POST /api/canvas/import             输出目录导入画布（目录递归/单文件）
  GET  /api/canvas/images             画布图片全量
  POST /api/canvas/image/delete       删除画布图片
  POST /api/canvas/workflow/save      保存工作流 JSON（output/workflows/）
  GET  /api/canvas/workflow/list      列出所有工作流
  GET  /api/canvas/workflow/load      按名加载工作流
  POST /api/canvas/recovery/save      创建恢复快照
  GET  /api/canvas/recovery/latest    读取最近恢复快照
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

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from core import canvas
from core.api import format_error, generate_image
from core.canvas import safe_ref_path_allowlist
from core.config import (
    ACTIVE_PROFILE,
    BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_QUALITY,
    DEFAULT_SIZE,
    QUALITY_OPTIONS,
    SIZE_OPTIONS,
    WORK_ROOT,
    get_api_key,
)
from core.history import read_generation_history
from core.logging import log_generation
from core.tasks import MAX_CONCURRENCY, GenerationTask, TaskManager

# 多开窗口：服务端原子分配递增编号（GIL 保证并发安全）
_WIN_LOCK = threading.Lock()
_WIN_VALUE = 0
# 生成文件名全局序号：秒级时间戳同秒并发必撞，加序号保证唯一
_SEQ = itertools.count(1)
# 参考图缓存：前端「添加即上传」落盘于此，跨窗口只传路径引用（不占浏览器存储配额）
REF_DIR = os.path.join(DEFAULT_OUTPUT_DIR, ".refs")


def _next_window_id() -> int:
    """分配下一个窗口编号（全局唯一，线程安全）"""
    global _WIN_VALUE
    with _WIN_LOCK:
        _WIN_VALUE += 1
        return _WIN_VALUE


def current_window_id() -> int:
    """当前已分配的最大窗口编号（只读，供状态展示）"""
    return _WIN_VALUE

# 参考图文件名全局序号
_REF_SEQ = itertools.count(1)
# 提交 id 全局序号（进程无关：时间戳 + 序号，供落盘提交图快照与账本追溯）
_SUB_SEQ = itertools.count(1)


def _next_submission_id() -> str:
    """生成稳定提交 id（sub-<epoch_ns>-<seq>），与内存任务 id 解耦"""
    return f"sub-{time.time_ns()}-{next(_SUB_SEQ):04d}"
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
    """仅接受 REF_DIR 内的绝对路径（防路径穿越）；非法返回 None（委托 pathtrust 统一实现）"""
    from core.pathtrust import match_roots
    return match_roots(path, [REF_DIR])


def relative_display_path(path: str, root: str | os.PathLike[str]) -> str:
    """返回不含盘符的可读相对路径；Windows 跨盘时使用稳定的上跳形式。"""
    try:
        rel = os.path.relpath(path, root)
    except ValueError:
        _, tail = os.path.splitdrive(os.path.abspath(path))
        rel = os.path.join("..", "..", tail.lstrip("\\/"))
    return rel.replace("\\", "/")


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

BASE_DIR = (
    Path(sys.executable).resolve().parent.parent
    if getattr(sys, "frozen", False)
    else Path(__file__).resolve().parent
)
FRONTEND_DIR = BASE_DIR / "frontend"
DIST_DIR = FRONTEND_DIR / "dist"

# 尺寸/质量选项来自配置中心（core/config.py），/api/config 原样下发前端

app = FastAPI(title="Imagora")
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


def _directory_writable(path: str) -> bool:
    probe = ""
    try:
        os.makedirs(path, exist_ok=True)
        fd, probe = tempfile.mkstemp(prefix=".imagora_probe_", dir=path)
        os.close(fd)
        return True
    except OSError:
        return False
    finally:
        if probe:
            try:
                os.unlink(probe)
            except OSError:
                pass


def resolve_history_output_path(output: str) -> str:
    """把日志里的输出路径解析为绝对路径，兼容从项目父目录启动。"""
    raw = str(output or "").strip()
    if not raw:
        return ""
    return os.path.normpath(raw if os.path.isabs(raw) else os.path.join(WORK_ROOT, raw))


@app.get("/api/health/details")
def health_details():
    """启动自检：只返回布尔状态和处理建议，不泄漏配置值。"""
    checks = {
        "apiKey": has_api_key(),
        "frontendBuilt": (DIST_DIR / "index.html").is_file(),
        "outputWritable": _directory_writable(load_last_output_dir() or DEFAULT_OUTPUT_DIR),
    }
    issues = []
    if not checks["apiKey"]:
        issues.append("未配置 API Key，生图任务暂不可用")
    if not checks["frontendBuilt"]:
        issues.append("前端尚未构建，请运行 npm run build")
    if not checks["outputWritable"]:
        issues.append("输出目录不可写，请检查目录权限")
    return {"ok": all(checks.values()), "checks": checks, "issues": issues}


@app.get("/api/config")
def get_config(win: int | None = None):
    """前端初始化配置。

    多开页面：前端传已有窗口号（URL ?win= 或 window.name 记忆）则沿用，
    否则服务端原子分配下一个编号；默认输出目录按窗口分区 output/win{N}。
    """
    window_id = win if win and win > 0 else _next_window_id()
    # 默认输出路径：优先记住的上次路径（服务重启沿用），无记录才按窗口分区
    last_dir = load_last_output_dir()
    default_dir = last_dir or os.path.join(DEFAULT_OUTPUT_DIR, f"win{window_id}")
    return {
        "sizes": SIZE_OPTIONS,
        "qualities": QUALITY_OPTIONS,
        "defaultOutputDir": default_dir,
        "windowId": window_id,
        "baseUrl": BASE_URL,
        "defaultModel": DEFAULT_MODEL,
        "activeProfile": ACTIVE_PROFILE,
    }


@app.get("/api/window/next")
def next_window():
    """分配下一个窗口编号（多开脚本 / 界面按钮用，与 /api/config 共用计数器，全局唯一）"""
    return {"windowId": _next_window_id()}


@app.get("/api/status")
def server_status():
    """只读服务状态：已分配的最大窗口编号（供启动脚本 / 控制台菜单展示）"""
    return {"windowCounter": current_window_id()}


@app.get("/api/history")
def generation_history(limit: int = 200, query: str = "", status: str = ""):
    """读取本地生成历史。

    图片存在性以**资产注册表为准**：账本行带 outputAssetIds 时，按 registry.resolve_asset
    解析（注册表副本在 .assets，移动原文件不丢），仅作参考的 output 路径不再参与判定；
    无 outputAssetIds 的旧行回退按 output 路径 isfile 判定。
    """
    records = read_generation_history(limit=limit, query=query, status=status)
    items = []
    for record in records:
        abs_path = ""
        asset_ids = record.get("outputAssetIds")
        if isinstance(asset_ids, list) and asset_ids:
            resolved = canvas.resolve_asset(str(asset_ids[0]))
            if resolved:
                abs_path = resolved["absPath"]
        if not abs_path:
            out_path = resolve_history_output_path(str(record.get("output", "")))
            if out_path and os.path.isfile(out_path):
                abs_path = out_path
        exists = bool(abs_path and os.path.isfile(abs_path))
        items.append({
            **record,
            "exists": exists,
            "path": abs_path if exists else "",
            "url": canvas.image_url(abs_path) if exists else "",
        })
    return {"items": items}


@app.post("/api/history/import")
def import_history_asset(body: dict):
    """把日志中真实存在的历史结果导入画布，拒绝任意未记录路径。"""
    requested = os.path.normcase(resolve_history_output_path(str(body.get("path", ""))))
    recorded_paths = {
        os.path.normcase(resolve_history_output_path(str(record.get("output", ""))))
        for record in read_generation_history(limit=500)
        if record.get("output")
    }
    if requested not in recorded_paths or not os.path.isfile(requested):
        return {"imported": [], "skipped": [{"path": requested, "reason": "不是可用的历史输出"}]}
    entry = canvas.register_asset(requested, os.path.basename(requested))
    return {
        "imported": [entry] if entry else [],
        "skipped": [] if entry else [{"path": requested, "reason": "导入失败"}],
    }


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
            "url": canvas.image_url(dest),
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


@app.post("/api/output-dir")
def remember_output_dir(path: str = Body(..., embed=True)):
    """记住输出路径：用户一改路径前端即上报，服务重启后 /api/config 默认返回它"""
    save_last_output_dir(str(path))
    return {"ok": True}


@app.post("/api/canvas/upload")
def canvas_upload(images: list[UploadFile] = File(default=[])):
    """画布图片上传：复制进 output/.canvas/ 并登记 registry（同内容去重）"""
    entries = []
    for image in images:
        ext = (Path(image.filename or "img").suffix or ".png").lower()
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(image.file.read())
            tmp_path = tmp.name
        try:
            entry = canvas.register_asset(tmp_path, image.filename or "image")
            if entry:
                entries.append(entry)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    return {"images": entries}


@app.post("/api/canvas/import")
def canvas_import(body: dict):
    """从输出目录导入图片（目录递归 / 单文件）到画布：复制进 .canvas 并登记

    路径必须落在 output 根内（realpath 前缀校验防穿越）；校验失败逐条进 skipped。
    """
    paths = [str(p) for p in body.get("paths", [])]
    return canvas.import_assets(paths)


@app.get("/api/canvas/images")
def canvas_images():
    """画布图片全量（每条含 absPath，生成时 ref_paths 引用）"""
    return {"images": canvas.list_assets()}


@app.post("/api/canvas/image/delete")
def canvas_image_delete(body: dict):
    """删除画布图片（注册表移除 + 尽力删文件；文件不存在容忍）"""
    img_id = str(body.get("id", ""))
    return {"ok": canvas.delete_asset(img_id)}


@app.post("/api/canvas/workflow/save")
def canvas_workflow_save(body: dict):
    """保存工作流为 JSON 文件（固定目录 output/workflows/<name>.json，仅需名字）

    图片节点落盘前归一化：只存 registryId + 元数据，不存派生路径 url/absPath
    （加载时按 registry 实时解析，项目目录改名后旧存档依然可恢复）。"""
    result = canvas.workflow_save(
        str(body.get("name", "")),
        body.get("nodes", []),
        body.get("edges", []),
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "保存失败"))
    return {"ok": True, "path": result["path"]}


@app.get("/api/canvas/workflow/list")
def canvas_workflow_list():
    """列出 output/workflows/ 下所有工作流（按修改时间倒序）"""
    return {"workflows": canvas.workflow_list()}


@app.get("/api/canvas/workflow/load")
def canvas_workflow_load(name: str):
    """加载工作流 JSON（固定目录按名加载）：按 registryId 实时解析图片节点路径
    （不信任存档中的旧绝对路径，项目目录改名后自愈）；缺失 registryId 进 missing"""
    result = canvas.workflow_load(name)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "加载失败"))
    return {
        "name": result["name"],
        "nodes": result["nodes"],
        "edges": result["edges"],
        "missing": result["missing"],
    }


@app.post("/api/canvas/recovery/save")
def canvas_recovery_save(body: dict):
    """创建一份独立恢复快照，不覆盖手动命名工作流（图片节点同样归一化落盘）。"""
    result = canvas.recovery_save(body.get("nodes", []), body.get("edges", []))
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "自动保存失败"))
    return result


@app.get("/api/canvas/recovery/latest")
def canvas_recovery_latest():
    """返回最近一份可读恢复快照；没有快照时返回 empty。"""
    return canvas.recovery_latest()


@app.post("/api/canvas/import-submission")
def canvas_import_submission(body: dict):
    """经典提交整图导入画布：按 submissionId 读取提交图快照，实时解析资产路径。

    返回 {name, nodes, edges, missing}（图片节点已解析 absPath/url，缺失进 missing）。
    """
    submission_id = str(body.get("submissionId", ""))
    result = canvas.submission_load(submission_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "导入提交失败"))
    return {
        "name": result["name"],
        "nodes": result["nodes"],
        "edges": result["edges"],
        "missing": result["missing"],
    }


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
    return relative_display_path(path, WORK_ROOT)


def run_generation(task: GenerationTask) -> None:
    """在全局任务池的线程中执行一次生成，把结果写回任务。

    成功写 task.results / task.messages / task.total_cost；
    失败写 task.error（TaskManager 据此置 failed）。临时兜底文件由 TaskManager 统一清理。
    """
    out_dir = (task.output_dir.strip() or DEFAULT_OUTPUT_DIR).rstrip("\\/")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    started_at = time.time()
    cost = size_cost(task.size)
    results: list[dict] = []
    messages: list[str] = []
    dest = ""
    ok = False
    try:
        if task.ref_bases:
            # 复用已上传参考图（画布 / 参考图缓存），路径在提交时已校验
            seq = next(_SEQ)
            dest = os.path.join(out_dir, f"img2img_{stamp}_{seq:03d}.png")
            messages.append(f"图生图 · 参考图 {len(task.ref_bases)} 张")
            generate_image(
                prompt=task.prompt, images=task.ref_bases, size=task.size,
                quality=task.quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": canvas.image_url(dest), "size": task.size, "cost": cost, "fileSize": os.path.getsize(dest), "ext": Path(dest).suffix.lstrip(".")})
            messages.append(f"已保存 · {display_path(dest)}（{task.size}）")
        elif task.temp_bases:
            # multipart 兜底：底图已在提交线程落临时文件（UploadFile 不可跨线程）
            seq = next(_SEQ)
            dest = os.path.join(out_dir, f"img2img_{stamp}_{seq:03d}.png")
            messages.append(f"图生图 · 参考图 {len(task.temp_bases)} 张")
            generate_image(
                prompt=task.prompt, images=task.temp_bases, size=task.size,
                quality=task.quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": canvas.image_url(dest), "size": task.size, "cost": cost, "fileSize": os.path.getsize(dest), "ext": Path(dest).suffix.lstrip(".")})
            messages.append(f"已保存 · {display_path(dest)}（{task.size}）")
        else:
            seq = next(_SEQ)
            dest = os.path.join(out_dir, f"txt2img_{stamp}_{seq:03d}.png")
            messages.append("文生图")
            generate_image(
                prompt=task.prompt, image_path=None, size=task.size,
                quality=task.quality, output_format="png", output_path=dest,
            )
            results.append({"status": "ok", "message": f"已保存: {display_path(dest)}", "url": canvas.image_url(dest), "size": task.size, "cost": cost, "fileSize": os.path.getsize(dest), "ext": Path(dest).suffix.lstrip(".")})
            messages.append(f"已保存 · {display_path(dest)}（{task.size}）")
        ok = True
    except Exception as e:
        msg = format_error(e)
        task.error = msg
        results.append({"status": "error", "message": msg})
        messages.append(f"失败 · {msg}")

    total_cost = sum(r.get("cost", 0) for r in results if r.get("status") == "ok")
    ok_count = sum(1 for r in results if r.get("status") == "ok")
    messages.append(f"本次成功 {ok_count} 张 · 费用 {total_cost:.2f} 元")

    # 记住本次输出路径：下次服务启动默认沿用（生成失败不算"用过"）
    if ok_count > 0:
        save_last_output_dir(out_dir)

    task.results = results
    task.messages = messages
    task.total_cost = total_cost
    # 旁路：生成成功后注册结果图/参考图并落提交图快照（失败不影响生成结果）
    submission_meta: dict | None = None
    if ok_count > 0 and task.submission_id:
        try:
            submission_meta = _persist_submission(task)
        except Exception:
            submission_meta = None
    log_generation(
        prompt=task.prompt,
        mode="img2img" if (task.temp_bases or task.ref_bases) else "txt2img",
        refs=len(task.temp_bases) + len(task.ref_bases),
        size=task.size,
        quality=task.quality,
        status="ok" if ok else "error",
        output=dest if ok else "",
        cost=total_cost,
        seconds=time.time() - started_at,
        win=task.win or None,
        submission_id=task.submission_id or "",
        input_asset_ids=(submission_meta or {}).get("input_asset_ids"),
        output_asset_ids=(submission_meta or {}).get("output_asset_ids"),
    )


def _persist_submission(task: GenerationTask) -> dict | None:
    """旁路：把本次成功结果 + 参考图注册进 .canvas 并落提交图快照。

    参考图只对 ref_bases（已在 .refs/.canvas 白名单）晋升为 kind='ref'；
    multipart 兜底的未同步本地图（temp_bases）不晋升，仅结果注册。
    任何失败不抛（由调用方 try/except 兜底），成功与否不影响生成结果。
    返回 {"input_asset_ids": [...], "output_asset_ids": [...]} 供账本联动；无结果返回 None。
    """
    def _path_from_url(url: str) -> str:
        try:
            from urllib.parse import parse_qs, urlparse
            return parse_qs(urlparse(url).query).get("path", [""])[0] or ""
        except Exception:
            return ""

    input_entries: list[dict] = []
    seen_input: set[str] = set()
    for rb in task.ref_bases:
        try:
            entry = canvas.register_asset(rb, Path(rb).name, kind="ref", source_key=task.submission_id)
        except Exception:
            entry = None
        if entry and entry["id"] not in seen_input:
            seen_input.add(entry["id"])
            input_entries.append(entry)

    result_entries: list[dict] = []
    seen_result: set[str] = set()
    for res in task.results:
        if res.get("status") != "ok" or not res.get("url"):
            continue
        dest = _path_from_url(res["url"])
        if not dest or not os.path.isfile(dest):
            continue
        try:
            entry = canvas.register_asset(dest, os.path.basename(dest), kind="result", source_key=task.submission_id)
        except Exception:
            entry = None
        if entry and entry["id"] not in seen_result:
            seen_result.add(entry["id"])
            result_entries.append(entry)

    if not result_entries:
        return None
    params = {"size": task.size, "quality": task.quality, "outputDir": task.output_dir}
    canvas.submission_save(
        task.submission_id, task.prompt, params, input_entries, result_entries, task.win,
    )
    return {
        "input_asset_ids": [e["id"] for e in input_entries],
        "output_asset_ids": [e["id"] for e in result_entries],
    }


# 全局生成任务池：执行池大小即全局并发上限，所有窗口 / 模式共享（详见 core/tasks.py）
task_manager = TaskManager(concurrency=MAX_CONCURRENCY, run_task=run_generation)


@app.post("/api/generate")
def generate(prompt: str = Form(...), size: str = Form(DEFAULT_SIZE),
             quality: str = Form(DEFAULT_QUALITY), output_dir: str = Form(""),
             images: list[UploadFile] = File(default=[]),
             ref_paths: str = Form(""),
             win: int = Form(0)):
    """提交生成任务（文生图 / 图生图），立即返回 taskId 与初始状态。

    实际生成进入全局任务池排队执行（并发上限 10，经典表单与无限画布共用），
    前端轮询 GET /api/tasks/{taskId} 获取状态与最终结果。
    同步提交：仅在提交阶段做参数校验与文件落盘，不阻塞生成。
    """
    ref_bases: list[str] = []
    if ref_paths:
        try:
            ref_list = json.loads(ref_paths)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="参考图参数非法")
        # 只接受 REF_DIR / ASSET_DIR 内路径，防路径穿越（校验失败不占执行槽）
        for p in ref_list:
            safe = safe_ref_path_allowlist(p, [REF_DIR, canvas.ASSET_DIR])
            if not safe or not os.path.isfile(safe):
                raise HTTPException(status_code=400, detail=f"非法参考图路径: {p}")
            ref_bases.append(safe)

    # multipart 兜底文件：UploadFile 不能跨线程读取，必须在请求线程落临时文件
    temp_bases: list[str] = []
    for image in images:
        with tempfile.NamedTemporaryFile(
            suffix=Path(image.filename or "img").suffix or ".png", delete=False
        ) as tmp:
            tmp.write(image.file.read())
            temp_bases.append(tmp.name)

    task = GenerationTask(
        prompt=prompt, size=size, quality=quality, output_dir=output_dir, win=win,
        ref_bases=ref_bases, temp_bases=temp_bases, submission_id=_next_submission_id(),
    )
    task_id = task_manager.submit(task)
    return {"taskId": task_id, "status": task.status}


@app.get("/api/tasks/{task_id}")
def task_status(task_id: str):
    """查询生成任务状态（前端轮询）。终态保留 10 分钟，超时或不存在返回 404。"""
    snap = task_manager.snapshot(task_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return snap


@app.post("/api/tasks/{task_id}/cancel")
def cancel_task(task_id: str):
    """请求取消任务：排队中不再执行；生成中无法中断上游请求，跑完后丢弃结果。"""
    return {"ok": task_manager.cancel(task_id)}


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
    """生成可访问图片文件的相对 URL（单一实现收敛在 core/canvas.py）"""
    return canvas.image_url(path)


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
            "<p>请先在 Imagora 目录执行：</p>"
            "<pre>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</pre>"
            "<p>构建完成后刷新本页。详见 README「快速开始」。</p>",
            status_code=503,
        )

