#!/usr/bin/env python3
"""核心：核心资产注册表（asset registry）——全项目统一图片持久化。
画布/生成结果/晋升参考图统一登记于此，按内容 sha1 去重，永不自动清理。
原为 core/canvas.py 的一部分，现拆出以便职责单一。
"""
import hashlib
import json
import os
import shutil
import threading
import time
from pathlib import Path
from urllib.parse import quote
from core.config import DEFAULT_OUTPUT_DIR
from core.imageinfo import image_dimensions


ASSET_DIR = os.path.join(DEFAULT_OUTPUT_DIR, ".assets")

LEGACY_ASSET_DIR = os.path.join(DEFAULT_OUTPUT_DIR, ".canvas")

REGISTRY_FILE = os.path.join(ASSET_DIR, "registry.json")

REGISTRY_SCHEMA_VERSION = 2

_REGISTRY_LOCK = threading.Lock()

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}

def load_registry() -> dict[str, dict]:
    """读取注册表（id -> entry）。

    v2 包装（{\"schemaVersion\", \"images\"}）与 v1 裸 dict（无版本字段的旧清单）均兼容；
    缺失 / 损坏返回 {} 不抛异常（恢复由迁移脚本按文件重建）。
    """
    try:
        with open(REGISTRY_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    if isinstance(data, dict):
        inner = data.get("images")
        if isinstance(inner, dict):
            return inner  # v2
        if "schemaVersion" not in data:
            return data  # v1 裸 dict
    return {}

def save_registry(entries: dict[str, dict]) -> None:
    """原子写注册表（tmp 文件 + os.replace，防并发读半文件）；按当前 schema 版本落盘 v2 包装"""
    os.makedirs(ASSET_DIR, exist_ok=True)
    payload = {"schemaVersion": REGISTRY_SCHEMA_VERSION, "images": entries}
    tmp = REGISTRY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, REGISTRY_FILE)

def _entry_from_src(
    img_id: str, src_abs: str, original_name: str, dest_name: str,
    kind: str = "canvas", source_key: str | None = None,
) -> dict:
    """由源文件构建注册表条目（id 为内容 sha1 前缀，relPath 相对 DEFAULT_OUTPUT_DIR 正斜杠）。

    v2 起附带可选宽高/格式（imageinfo 头部探测，失败时不带——旧字段宽兼容）；
    可选来源标签 kind（canvas/result/ref）与 sourceKey（产生它的提交 id）供追溯，
    缺省不影响旧读取器。
    """
    entry = {
        "id": img_id,
        "relPath": os.path.relpath(
            os.path.join(ASSET_DIR, dest_name), DEFAULT_OUTPUT_DIR
        ).replace("\\", "/"),
        "name": original_name or dest_name,
        "size": os.path.getsize(src_abs),
        "ext": Path(dest_name).suffix.lstrip("."),
        "createdAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "kind": kind,
    }
    if source_key:
        entry["sourceKey"] = source_key
    dims = image_dimensions(src_abs)
    if dims:
        entry.update({"width": dims["width"], "height": dims["height"], "format": dims["format"]})
    return entry

def image_url(path: str) -> str:
    """构建图片可访问 URL（/api/image?path= 编码绝对路径）——全项目唯一入口

    server.py 的 /api/image 端点、画布节点 url 都走这里，改约定只改一处。
    """
    return f"/api/image?path={quote(path)}"

def register_asset(
    src_abs: str, original_name: str = "", kind: str = "canvas", source_key: str | None = None,
) -> dict | None:
    """复制图片进注册表并登记；同内容（同 sha1）返回已有 entry（去重：一个文件一个节点）。

    源文件不存在返回 None；目标文件名为 canv_<sha1[:12]>.<ext>。
    kind/source_key 为可选来源标签（canvas/result/ref + 提交 id），仅首次登记时写入；
    **已存在条目以首次来源为准，后续不同来源不覆盖**（内容去重语义优先）。
    返回条目附 absPath 与 url（registry 落盘不存两者，均由 relPath 可推导）。
    """
    if not os.path.isfile(src_abs):
        return None
    with open(src_abs, "rb") as f:
        content = f.read()
    img_id = hashlib.sha1(content).hexdigest()[:12]
    ext = Path(src_abs).suffix.lower().lstrip(".") or "png"
    dest_name = f"canv_{img_id}.{ext}"
    dest_abs = os.path.normpath(os.path.join(ASSET_DIR, dest_name))
    with _REGISTRY_LOCK:
        entries = load_registry()
        if img_id in entries:
            entry = entries[img_id]
            return {**entry, "absPath": dest_abs, "url": image_url(dest_abs)}
        os.makedirs(ASSET_DIR, exist_ok=True)
        with open(dest_abs, "wb") as f:
            f.write(content)
        entry = _entry_from_src(img_id, src_abs, original_name, dest_name, kind, source_key)
        entries[img_id] = entry
        save_registry(entries)
        return {**entry, "absPath": dest_abs, "url": image_url(dest_abs)}

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

def import_assets(paths: list[str]) -> dict:
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
            entry = register_asset(f, os.path.basename(f))
            if entry:
                imported.append(entry)
    return {"imported": imported, "skipped": skipped}

def delete_asset(img_id: str) -> bool:
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

def list_assets(kind: str | None = None) -> list[dict]:
    """资产全量列表，每条附 absPath 与 url（生成时 ref_paths 引用 / 显示）。

    kind 为可选来源过滤（canvas/result/ref），None 返回全部；缺 kind 的旧条目
    在精确过滤时被排除（不误判来源）。
    """
    with _REGISTRY_LOCK:
        entries = load_registry()
        images = []
        for entry in entries.values():
            if kind is not None and entry.get("kind") != kind:
                continue
            item = dict(entry)
            abs_path = os.path.normpath(
                os.path.join(DEFAULT_OUTPUT_DIR, entry["relPath"])
            )
            item["absPath"] = abs_path
            item["url"] = image_url(abs_path)
            images.append(item)
        return images

def resolve_asset(img_id: str) -> dict | None:
    """按 registryId 解析资产的绝对路径与 URL（单一事实来源）。

    注册表缺失或文件不存在返回 None（对应工作流加载的 missing 语义）；
    路径由 registry 相对路径实时推导，项目目录改名后仍有效。
    """
    entries = load_registry()
    entry = entries.get(str(img_id))
    if not entry:
        return None
    abs_path = os.path.normpath(os.path.join(DEFAULT_OUTPUT_DIR, entry["relPath"]))
    if not os.path.isfile(abs_path):
        return None
    return {"absPath": abs_path, "url": image_url(abs_path)}

def safe_ref_path_allowlist(path: str, roots: list[str]) -> str | None:
    """路径白名单校验（委托 core.pathtrust.match_roots 统一实现）"""
    from core.pathtrust import match_roots
    return match_roots(path, roots)



# ================= 注册表迁移（registry 自带，避免经由 shim 绕行） =================

def _mig_ts() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def _backup_then_write(path: str, payload: dict) -> str | None:
    """备份旧文件并原子写入新 payload；返回备份路径（无旧文件返回 None）。失败抛 OSError。"""
    backup_path = None
    if os.path.isfile(path):
        backup_path = f"{path}.bak-{_mig_ts()}"
        shutil.copy2(path, backup_path)
    tmp = f"{path}.migrate-{os.getpid()}-{time.time_ns()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    return backup_path


def detect_registry() -> dict:
    """检测注册表状态：{state: v2|v1|missing|corrupt, count, kind_missing}"""
    if not os.path.isfile(REGISTRY_FILE):
        return {"state": "missing", "count": 0, "kind_missing": 0}
    try:
        with open(REGISTRY_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {"state": "corrupt", "count": 0, "kind_missing": 0}
    if not isinstance(data, dict):
        return {"state": "corrupt", "count": 0, "kind_missing": 0}
    if isinstance(data.get("images"), dict):
        return {
            "state": "v2", "count": len(data["images"]),
            "kind_missing": sum(1 for e in data["images"].values() if not isinstance(e, dict) or "kind" not in e),
        }
    if "schemaVersion" not in data:
        return {
            "state": "v1", "count": len(data),
            "kind_missing": sum(1 for e in data.values() if not isinstance(e, dict) or "kind" not in e),
        }
    return {"state": "corrupt", "count": 0, "kind_missing": 0}


def _entry_with_dims(entry: dict, out_root: str) -> dict:
    """给 v1 条目补宽高/格式（文件存在且可解析时），保持其余字段原样"""
    dims = None
    rel = entry.get("relPath")
    if rel:
        abs_path = os.path.normpath(os.path.join(out_root, rel))
        if os.path.isfile(abs_path):
            dims = image_dimensions(abs_path)
    if not dims:
        return entry
    return {**entry, **dims}


def upgrade_registry(apply: bool) -> dict:
    """v1 裸清单 → v2 包装（逐条补宽高/格式）；已是 v2/缺失/损坏按状态原样报告。"""
    state = detect_registry()
    if state["state"] != "v1":
        return {"registry": state, "action": "none", "backup": None}
    with _REGISTRY_LOCK:
        entries = load_registry()
        upgraded = {i: _entry_with_dims(e, DEFAULT_OUTPUT_DIR) for i, e in entries.items()}
    if not apply:
        return {"registry": state, "action": "upgrade-to-v2", "backup": None, "entries": len(upgraded)}
    payload = {"schemaVersion": REGISTRY_SCHEMA_VERSION, "images": upgraded}
    backup = _backup_then_write(REGISTRY_FILE, payload)
    reloaded = load_registry()
    ok = len(reloaded) == len(upgraded)
    return {
        "registry": {"state": "v2", "count": len(reloaded)},
        "action": "upgraded-to-v2" if ok else "FAILED-VERIFY",
        "backup": backup,
        "entries": len(reloaded),
    }


def rebuild_registry(apply: bool) -> dict:
    """清单缺失/损坏时按 ASSET_DIR 下的 canv_* 文件重建 v2 清单。"""
    candidates = []
    try:
        for name in sorted(os.listdir(ASSET_DIR)):
            if not name.startswith("canv_") or not name.endswith(tuple(IMAGE_EXTENSIONS)):
                continue
            stem, ext = os.path.splitext(name)
            img_id = stem[len("canv_"):]
            abs_path = os.path.normpath(os.path.join(ASSET_DIR, name))
            candidates.append({
                "id": img_id,
                "relPath": os.path.relpath(abs_path, DEFAULT_OUTPUT_DIR).replace("\\", "/"),
                "name": name,
                "size": os.path.getsize(abs_path),
                "ext": ext.lstrip(".").lower(),
                "createdAt": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(abs_path))),
            })
    except OSError:
        candidates = []
    if not candidates:
        return {"action": "nothing-to-rebuild", "restored": 0}
    if not apply:
        return {"action": "rebuild-ready", "restored": len(candidates)}
    entries = {}
    with _REGISTRY_LOCK:
        for c in candidates:
            dims = image_dimensions(os.path.normpath(os.path.join(DEFAULT_OUTPUT_DIR, c["relPath"])))
            entries[c["id"]] = {**c, **(dims or {})}
        if os.path.isfile(REGISTRY_FILE):
            shutil.copy2(REGISTRY_FILE, f"{REGISTRY_FILE}.bak-{_mig_ts()}")
        payload = {"schemaVersion": REGISTRY_SCHEMA_VERSION, "images": entries}
        tmp = f"{REGISTRY_FILE}.rebuild-{time.time_ns()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, REGISTRY_FILE)
    return {"action": "rebuilt", "restored": len(entries)}


def backfill_asset_meta(apply: bool) -> dict:
    """给缺可选来源标签（kind）的旧条目补 kind='canvas'（幂等、只加不改结构）。"""
    state = detect_registry()
    if state.get("state") not in ("v1", "v2"):
        return {"asset_meta": state, "action": "none", "backup": None}
    missing = state.get("kind_missing", 0)
    if missing == 0:
        return {"asset_meta": state, "action": "noop", "backfilled": 0}
    if not apply:
        return {"asset_meta": state, "action": "backfill-ready", "backfilled": missing}
    with _REGISTRY_LOCK:
        entries = load_registry()
        filled = 0
        for img_id, entry in entries.items():
            if isinstance(entry, dict) and "kind" not in entry:
                entries[img_id] = {**entry, "kind": "canvas"}
                filled += 1
        if filled == 0:
            return {"asset_meta": detect_registry(), "action": "noop", "backfilled": 0}
        payload = {"schemaVersion": REGISTRY_SCHEMA_VERSION, "images": entries}
        backup = _backup_then_write(REGISTRY_FILE, payload)
    reloaded = load_registry()
    ok = len(reloaded) == len(entries)
    return {
        "asset_meta": detect_registry(),
        "action": "backfilled" if ok else "FAILED-VERIFY",
        "backfilled": filled,
        "backup": backup,
    }


def relocate_asset_dir(apply: bool) -> dict:
    """存量资产目录 .canvas -> 规范名 .assets（搬文件 + 重写 registry relPath 前缀）。"""
    legacy = LEGACY_ASSET_DIR
    new = ASSET_DIR
    if os.path.isdir(new) and os.path.isfile(os.path.join(new, "registry.json")):
        return {"action": "noop", "reason": ".assets 已存在"}
    if not os.path.isdir(legacy):
        return {"action": "nothing", "reason": "旧目录 .canvas 不存在"}
    files = [n for n in sorted(os.listdir(legacy)) if n.startswith("canv_")]
    if not apply:
        return {"action": "ready", "files": len(files)}
    bak = legacy + f"-bak-{_mig_ts()}"
    if not os.path.isdir(bak):
        shutil.copytree(legacy, bak)
    reg = os.path.join(legacy, "registry.json")
    if os.path.isfile(reg):
        with open(reg, encoding="utf-8") as f:
            data = json.load(f)
        entries = data.get("images") if isinstance(data, dict) and isinstance(data.get("images"), dict) else (data if isinstance(data, dict) else {})
        for e in entries.values():
            if isinstance(e, dict) and isinstance(e.get("relPath"), str):
                e["relPath"] = e["relPath"].replace(".canvas/", ".assets/")
        payload = {"schemaVersion": REGISTRY_SCHEMA_VERSION, "images": entries}
        with open(reg, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(legacy, new)
    reloaded = load_registry()
    return {"action": "moved", "files": len(files), "backup": bak, "entries": len(reloaded)}


def migrate(apply: bool = False, rebuild: bool = False, backfill: bool = True) -> dict:
    """注册表一步到最新：先迁目录，再升级/重建，再回填 kind。

    顺序关键：先 relocate（.canvas->.assets 重写 relPath），旧目录不在 .assets 时升级会读到空。
    """
    report = {"relocate": relocate_asset_dir(apply)}
    if rebuild:
        report["registry"] = rebuild_registry(apply)
    else:
        report["registry"] = upgrade_registry(apply)
    report["asset_meta"] = backfill_asset_meta(apply) if backfill else {"action": "skipped"}
    return report
