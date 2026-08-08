#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""画布图片注册表 —— 无限画布工作流的图片持久化

画布引用的所有图片统一复制进 output/.canvas/（永不自动清理，区别于 .refs 24h 清理），
以内容 sha1 去重命名并登记到 registry.json；供 server.py 路由薄层调用。

核心函数:
  register_file()              复制图片进画布并登记（同内容去重）
  import_images()              输出目录导入（目录递归 / 单文件，路径穿越校验）
  delete_image()               删除画布图片（注册表 + 文件）
  list_images()                画布图片全量（附绝对路径，供生成时引用）
  safe_ref_path_allowlist()    路径白名单校验（.refs / .canvas 双根）
"""
import hashlib
import json
import os
import threading
import time
from pathlib import Path

from core.config import DEFAULT_OUTPUT_DIR

# 画布图片目录：永不自动清理（与 .refs 24h 清理区分）
CANVAS_DIR = os.path.join(DEFAULT_OUTPUT_DIR, ".canvas")
# 注册表：id -> { id, relPath, name, size, ext, createdAt }
REGISTRY_FILE = os.path.join(CANVAS_DIR, "registry.json")
# 注册表读写锁：多窗口并发 import/delete 安全
_REGISTRY_LOCK = threading.Lock()
# 导入允许的图片后缀
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def load_registry() -> dict[str, dict]:
    """读取注册表（id -> entry）；缺失 / 损坏返回空 dict 不抛异常"""
    try:
        with open(REGISTRY_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_registry(entries: dict[str, dict]) -> None:
    """原子写注册表（tmp 文件 + os.replace，防并发读半文件）"""
    os.makedirs(CANVAS_DIR, exist_ok=True)
    tmp = REGISTRY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    os.replace(tmp, REGISTRY_FILE)


def _entry_from_src(img_id: str, src_abs: str, original_name: str, dest_name: str) -> dict:
    """由源文件构建注册表条目（id 为内容 sha1 前缀，relPath 相对 DEFAULT_OUTPUT_DIR 正斜杠）"""
    return {
        "id": img_id,
        "relPath": os.path.relpath(
            os.path.join(CANVAS_DIR, dest_name), DEFAULT_OUTPUT_DIR
        ).replace("\\", "/"),
        "name": original_name or dest_name,
        "size": os.path.getsize(src_abs),
        "ext": Path(dest_name).suffix.lstrip("."),
        "createdAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def register_file(src_abs: str, original_name: str = "") -> dict | None:
    """复制图片进画布并登记；同内容（同 sha1）返回已有 entry（去重：一个文件一个节点）。

    源文件不存在返回 None；目标文件名为 canv_<sha1[:12]>.<ext>。
    """
    if not os.path.isfile(src_abs):
        return None
    with open(src_abs, "rb") as f:
        content = f.read()
    img_id = hashlib.sha1(content).hexdigest()[:12]
    ext = Path(src_abs).suffix.lower().lstrip(".") or "png"
    dest_name = f"canv_{img_id}.{ext}"
    with _REGISTRY_LOCK:
        entries = load_registry()
        if img_id in entries:
            return entries[img_id]
        os.makedirs(CANVAS_DIR, exist_ok=True)
        dest_abs = os.path.join(CANVAS_DIR, dest_name)
        with open(dest_abs, "wb") as f:
            f.write(content)
        entry = _entry_from_src(img_id, src_abs, original_name, dest_name)
        entries[img_id] = entry
        save_registry(entries)
        return entry


def _collect_image_files(path: str) -> list[str]:
    """收集目录（递归）或单文件下的图片绝对路径；非图片返回空列表"""
    if os.path.isfile(path):
        return [path] if Path(path).suffix.lower() in IMAGE_EXTENSIONS else []
    if os.path.isdir(path):
        files = []
        for root, _dirs, names in os.walk(path):
            for name in names:
                p = os.path.join(root, name)
                if Path(p).suffix.lower() in IMAGE_EXTENSIONS:
                    files.append(p)
        return files
    return []


def import_images(paths: list[str]) -> dict:
    """导入输出目录内的图片（目录递归 / 单文件）到画布注册表。

    每个路径必须真实存在且落在 output 根内（realpath 前缀校验防穿越）；
    校验失败的逐条记入 skipped 不抛异常。
    返回 {"imported": [entry], "skipped": [{"path", "reason"}]}
    """
    try:
        out_root = os.path.realpath(DEFAULT_OUTPUT_DIR)
    except ValueError:
        out_root = os.path.abspath(DEFAULT_OUTPUT_DIR)
    imported: list[dict] = []
    skipped: list[dict] = []
    for p in paths:
        abs_path = os.path.abspath(p)
        try:
            real = os.path.realpath(abs_path)
            inside = os.path.commonpath([real, out_root]) == out_root
        except ValueError:
            inside = False
        if not inside:
            skipped.append({"path": p, "reason": "路径不在输出目录内"})
            continue
        files = _collect_image_files(abs_path)
        if not files:
            skipped.append({"path": p, "reason": "不存在或没有图片文件"})
            continue
        for f in files:
            entry = register_file(f, os.path.basename(f))
            if entry:
                imported.append(entry)
    return {"imported": imported, "skipped": skipped}


def delete_image(img_id: str) -> bool:
    """删除画布图片：注册表移除 + 尽力删文件（文件不存在容忍）"""
    with _REGISTRY_LOCK:
        entries = load_registry()
        entry = entries.pop(img_id, None)
        if entry is None:
            return False
        save_registry(entries)
    try:
        os.unlink(os.path.join(DEFAULT_OUTPUT_DIR, entry["relPath"]))
    except OSError:
        pass
    return True


def list_images() -> list[dict]:
    """画布图片全量列表，每条附 absPath（生成时 ref_paths 引用）"""
    with _REGISTRY_LOCK:
        entries = load_registry()
        images = []
        for entry in entries.values():
            item = dict(entry)
            item["absPath"] = os.path.normpath(
                os.path.join(DEFAULT_OUTPUT_DIR, entry["relPath"])
            )
            images.append(item)
        return images


def safe_ref_path_allowlist(path: str, roots: list[str]) -> str | None:
    """路径白名单校验：abs path 与任一 root 的 commonpath 匹配则返回 abs，否则 None"""
    try:
        abs_path = os.path.abspath(path)
        for root in roots:
            root_abs = os.path.abspath(root)
            if os.path.commonpath([abs_path, root_abs]) == root_abs:
                return abs_path
    except ValueError:
        return None
    return None
