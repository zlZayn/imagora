#!/usr/bin/env python3
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
import re
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
    返回条目附 absPath（registry 落盘不存 absPath，它由 relPath 可推导）。
    """
    if not os.path.isfile(src_abs):
        return None
    with open(src_abs, "rb") as f:
        content = f.read()
    img_id = hashlib.sha1(content).hexdigest()[:12]
    ext = Path(src_abs).suffix.lower().lstrip(".") or "png"
    dest_name = f"canv_{img_id}.{ext}"
    dest_abs = os.path.join(CANVAS_DIR, dest_name)
    with _REGISTRY_LOCK:
        entries = load_registry()
        if img_id in entries:
            entry = entries[img_id]
            return {**entry, "absPath": os.path.normpath(dest_abs)}
        os.makedirs(CANVAS_DIR, exist_ok=True)
        with open(dest_abs, "wb") as f:
            f.write(content)
        entry = _entry_from_src(img_id, src_abs, original_name, dest_name)
        entries[img_id] = entry
        save_registry(entries)
        return {**entry, "absPath": os.path.normpath(dest_abs)}


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
    """路径白名单校验：abs path 与任一 root 的 commonpath 匹配则返回 abs，否则 None

    注意：commonpath 在跨盘（不同盘符）时抛 ValueError，需逐 root 单独捕获——
    某个 root 跨盘不代表其他 root 不匹配。
    """
    abs_path = os.path.abspath(path)
    for root in roots:
        try:
            root_abs = os.path.abspath(root)
            if os.path.commonpath([abs_path, root_abs]) == root_abs:
                return abs_path
        except ValueError:
            continue
    return None


# ---------- 工作流存取（version 1 JSON 文件，固定目录 output/workflows/） ----------

# 工作流固定保存目录（相对 output 根，用户只需选名字）
WORKFLOWS_DIR = os.path.join(DEFAULT_OUTPUT_DIR, "workflows")
# 自动恢复使用独立子目录，每次写新快照，不会覆盖用户手动命名的工作流。
RECOVERY_DIR = os.path.join(WORKFLOWS_DIR, ".recovery")
RECOVERY_LIMIT = 20
_RECOVERY_LOCK = threading.Lock()

# Windows / 通用非法文件名字符（含路径分隔符，防穿越）
_INVALID_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def sanitize_workflow_name(name: str) -> str | None:
    """工作流名 -> 安全文件名（去路径分隔符/非法字符，去点防隐藏，空返回 None）"""
    cleaned = _INVALID_NAME_CHARS.sub("", name.strip())
    if not cleaned or cleaned in (".", ".."):
        return None
    return cleaned


def _atomic_write_json(path: str, payload: dict) -> None:
    """用唯一临时文件原子写 JSON，支持多窗口同时保存。"""
    tmp = f"{path}.{threading.get_ident()}.{time.time_ns()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _missing_image_ids(nodes: list) -> list[str]:
    entries = load_registry()
    missing: list[str] = []
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") != "image":
            continue
        data_part = node.get("data")
        if not isinstance(data_part, dict):
            continue
        reg_id = str(data_part.get("registryId", ""))
        entry = entries.get(reg_id)
        abs_path = (
            os.path.normpath(os.path.join(DEFAULT_OUTPUT_DIR, entry["relPath"]))
            if entry else None
        )
        if not abs_path or not os.path.isfile(abs_path):
            missing.append(reg_id)
    return missing


def workflow_save(name: str, nodes: list, edges: list) -> dict:
    """保存工作流为 JSON 文件（固定目录 output/workflows/<name>.json）

    返回 {"ok": True, "path"} 或 {"ok": False, "error"}。
    """
    filename = sanitize_workflow_name(name)
    if not filename:
        return {"ok": False, "error": "工作流名不合法（不能含路径分隔符）"}
    abs_path = os.path.join(WORKFLOWS_DIR, f"{filename}.json")
    try:
        os.makedirs(WORKFLOWS_DIR, exist_ok=True)
        payload = {
            "version": 1,
            "name": filename,
            "nodes": nodes,
            "edges": edges,
        }
        with open(abs_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return {"ok": True, "path": abs_path}
    except (OSError, TypeError, ValueError) as e:
        return {"ok": False, "error": str(e)}


def workflow_list() -> list[dict]:
    """列出 output/workflows/ 下所有工作流（按修改时间倒序），条目含 name/modified"""
    workflows = []
    try:
        names = os.listdir(WORKFLOWS_DIR)
    except OSError:
        return workflows
    for name in names:
        if not name.lower().endswith(".json"):
            continue
        p = os.path.join(WORKFLOWS_DIR, name)
        try:
            modified = time.strftime(
                "%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p))
            )
        except OSError:
            modified = ""
        workflows.append({"name": os.path.splitext(name)[0], "modified": modified})
    workflows.sort(key=lambda w: w["modified"], reverse=True)
    return workflows


def workflow_load(name: str) -> dict:
    """加载工作流 JSON：校验 version、收集图片节点缺失项。

    图片节点按 registryId 查注册表 → relPath 解析绝对路径 → isfile 校验；
    缺失的 registryId 收集进 missing（节点保留原样，由前端标红）。
    返回 {"ok": True, "name", "nodes", "edges", "missing"} 或 {"ok": False, "error"}。
    """
    filename = sanitize_workflow_name(name)
    if not filename:
        return {"ok": False, "error": "工作流名不合法"}
    path = os.path.join(WORKFLOWS_DIR, f"{filename}.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return {"ok": False, "error": f"读取失败: {e}"}
    if not isinstance(data, dict) or data.get("version") != 1:
        return {"ok": False, "error": "不支持的版本（仅支持 version 1）"}
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return {"ok": False, "error": "工作流结构非法"}
    return {
        "ok": True,
        "name": str(data.get("name", "")),
        "nodes": nodes,
        "edges": edges,
        "missing": _missing_image_ids(nodes),
    }


def _recovery_paths() -> list[str]:
    try:
        names = [
            name for name in os.listdir(RECOVERY_DIR)
            if name.startswith("recovery_") and name.endswith(".json")
        ]
    except OSError:
        return []
    return [os.path.join(RECOVERY_DIR, name) for name in sorted(names, reverse=True)]


def _prune_recovery_snapshots(limit: int = RECOVERY_LIMIT) -> None:
    for path in _recovery_paths()[max(0, limit):]:
        try:
            os.unlink(path)
        except OSError:
            pass


def recovery_save(nodes: list, edges: list) -> dict:
    """创建独立恢复快照并轮转；永不写入手动工作流文件。"""
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return {"ok": False, "error": "恢复快照结构非法"}
    saved_at = time.strftime("%Y-%m-%d %H:%M:%S")
    name = f"recovery_{time.time_ns()}"
    path = os.path.join(RECOVERY_DIR, f"{name}.json")
    payload = {
        "version": 1,
        "name": name,
        "savedAt": saved_at,
        "nodes": nodes,
        "edges": edges,
    }
    try:
        with _RECOVERY_LOCK:
            os.makedirs(RECOVERY_DIR, exist_ok=True)
            _atomic_write_json(path, payload)
            _prune_recovery_snapshots(RECOVERY_LIMIT)
        return {"ok": True, "path": path, "name": name, "savedAt": saved_at}
    except (OSError, TypeError, ValueError) as e:
        return {"ok": False, "error": str(e)}


def recovery_latest() -> dict:
    """读取最近一份可用恢复快照；损坏文件自动跳过。"""
    for path in _recovery_paths():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or data.get("version") != 1:
            continue
        nodes = data.get("nodes")
        edges = data.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            continue
        return {
            "ok": True,
            "name": str(data.get("name", "")),
            "savedAt": str(data.get("savedAt", "")),
            "nodes": nodes,
            "edges": edges,
            "missing": _missing_image_ids(nodes),
        }
    return {"ok": False, "empty": True}
