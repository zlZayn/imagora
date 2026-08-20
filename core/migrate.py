#!/usr/bin/env python3
"""画布存储迁移：v1 老格式 → v2 新格式，以及损坏清单按文件重建。

纯逻辑（无 HTTP、无交互），供 scripts/migrate_canvas_v2.py 独立脚本调用；单测见 test_core_migrate.py。

安全语义：
  - 默认只报告（plan_*）：扫描并说明每个文件当前状态，不写任何文件。
  - apply_* 才落盘：先备份旧文件为 <path>.bak-<时间戳>，写 v2 后用 core.canvas 的加载器
    读回校验（条目/节点数一致），任一步失败不替换；迁移后旧格式仍可被程序读取（v1/v2 兼容）。
  - 幂等：已是 v2 的文件跳过，重复执行结果不变。
"""
import json
import os
import shutil
import time

from core import canvas
from core.imageinfo import image_dimensions


def _ts() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def _backup_then_write(path: str, payload: dict) -> str | None:
    """备份旧文件并原子写入新 payload；返回备份路径（无旧文件返回 None）。失败抛 OSError。"""
    backup_path = None
    if os.path.isfile(path):
        backup_path = f"{path}.bak-{_ts()}"
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


# ---------------- registry ----------------

def detect_registry() -> dict:
    """检测注册表状态：{state: v2|v1|missing|corrupt, count}"""
    if not os.path.isfile(canvas.REGISTRY_FILE):
        return {"state": "missing", "count": 0}
    try:
        with open(canvas.REGISTRY_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {"state": "corrupt", "count": 0}
    if not isinstance(data, dict):
        return {"state": "corrupt", "count": 0}
    if isinstance(data.get("images"), dict):
        return {"state": "v2", "count": len(data["images"])}
    if "schemaVersion" not in data:
        return {"state": "v1", "count": len(data)}
    return {"state": "corrupt", "count": 0}


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
    """v1 裸清单 → v2 包装（逐条补宽高/格式）；已是 v2 / 缺失 / 损坏按状态原样报告。
    返回计划或执行报告（默认不可变：无 apply 只报告）。"""
    state = detect_registry()
    if state["state"] != "v1":
        return {"registry": state, "action": "none", "backup": None}
    with canvas._REGISTRY_LOCK:
        entries = canvas.load_registry()
        upgraded = {
            img_id: _entry_with_dims(entry, canvas.DEFAULT_OUTPUT_DIR)
            for img_id, entry in entries.items()
        }
    if not apply:
        return {
            "registry": state,
            "action": "upgrade-to-v2",
            "backup": None,
            "entries": len(upgraded),
        }
    payload = {"schemaVersion": canvas.REGISTRY_SCHEMA_VERSION, "images": upgraded}
    backup = _backup_then_write(canvas.REGISTRY_FILE, payload)
    # 校验：用加载器读回，条目数与转换前一致才算成功
    reloaded = canvas.load_registry()
    ok = len(reloaded) == len(upgraded)
    return {
        "registry": {"state": "v2", "count": len(reloaded)},
        "action": "upgraded-to-v2" if ok else "FAILED-VERIFY",
        "backup": backup,
        "entries": len(reloaded),
    }


def rebuild_registry(apply: bool) -> dict:
    """清单缺失/损坏时按 .canvas/ 下的 canv_* 文件重建 v2 清单（id/name/ext 由文件名还原，
    size/dims 由文件实测）。默认只报告将恢复多少张；apply 才落盘（无旧清单可备份则直接写）。"""
    candidates = []
    try:
        for name in sorted(os.listdir(canvas.CANVAS_DIR)):
            if not name.startswith("canv_") or not name.endswith(tuple(canvas.IMAGE_EXTENSIONS)):
                continue
            stem, ext = os.path.splitext(name)
            img_id = stem[len("canv_"):]
            abs_path = os.path.normpath(os.path.join(canvas.CANVAS_DIR, name))
            candidates.append({
                "id": img_id,
                "relPath": os.path.relpath(abs_path, canvas.DEFAULT_OUTPUT_DIR).replace("\\", "/"),
                "name": name,
                "size": os.path.getsize(abs_path),
                "ext": ext.lstrip(".").lower(),
                "createdAt": time.strftime(
                    "%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(abs_path))
                ),
            })
    except OSError:
        candidates = []
    if not candidates:
        return {"action": "nothing-to-rebuild", "restored": 0}
    if not apply:
        return {"action": "rebuild-ready", "restored": len(candidates)}
    entries = {}
    with canvas._REGISTRY_LOCK:
        for c in candidates:
            dims = image_dimensions(
                os.path.normpath(os.path.join(canvas.DEFAULT_OUTPUT_DIR, c["relPath"]))
            )
            entries[c["id"]] = {**c, **(dims or {})}
        # 备份旧注册表（若存在损坏文件），再写 v2
        if os.path.isfile(canvas.REGISTRY_FILE):
            shutil.copy2(canvas.REGISTRY_FILE, f"{canvas.REGISTRY_FILE}.bak-{_ts()}")
        payload = {"schemaVersion": canvas.REGISTRY_SCHEMA_VERSION, "images": entries}
        tmp = f"{canvas.REGISTRY_FILE}.rebuild-{time.time_ns()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, canvas.REGISTRY_FILE)
    return {"action": "rebuilt", "restored": len(entries)}


# ---------------- workflows ----------------

def workflow_files() -> list[str]:
    try:
        names = [n for n in os.listdir(canvas.WORKFLOWS_DIR) if n.endswith(".json")]
    except OSError:
        return []
    return [os.path.join(canvas.WORKFLOWS_DIR, n) for n in sorted(names)]


def detect_workflow_version(path: str) -> int | None:
    """返回文件内 version（v1/v2）；损坏/缺失返回 None"""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data.get("version") if isinstance(data, dict) else None


def upgrade_workflow(path: str, apply: bool) -> dict:
    """单个工作流 v1 → v2（补 version 2 + savedAt，nodes/edges 原样）。
    默认只报告；apply 才备份+写+校验（加载器读回节点数一致才算成功）。"""
    version = detect_workflow_version(path)
    name = os.path.splitext(os.path.basename(path))[0]
    if version == canvas.WORKFLOW_VERSION:
        return {"name": name, "version": version, "action": "noop"}
    if version is None:
        return {"name": name, "version": version, "action": "skip-corrupt"}
    if not apply:
        return {"name": name, "version": version, "action": "upgrade-ready"}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return {"name": name, "version": version, "action": f"error:{e}"}
    saved_at = data.get("savedAt") or time.strftime("%Y-%m-%d %H:%M:%S")
    payload = {**data, "version": canvas.WORKFLOW_VERSION, "savedAt": saved_at}
    backup = _backup_then_write(path, payload)
    # 校验：加载器读回，节点数为 0 的老档视为合法；有节点时节点数必须一致
    result = canvas.workflow_load(name)
    nodes_ok = result.get("ok") is True and len(result.get("nodes", [])) == len(data.get("nodes", []))
    return {
        "name": name,
        "version": canvas.WORKFLOW_VERSION,
        "action": "upgraded" if nodes_ok else "FAILED-VERIFY",
        "backup": backup,
    }


# ---------------- 汇总 ----------------

def plan_or_apply(apply: bool = False, rebuild: bool = False) -> dict:
    """全量迁移入口：registry（升级或重建）+ 全部工作流。

    默认（apply=False）只报告每项将做什么；apply=True 才备份→转换→校验。
    """
    report: dict = {"apply": apply}
    if rebuild:
        report["registry"] = rebuild_registry(apply)
    else:
        report["registry"] = upgrade_registry(apply)
    wf_reports = []
    for path in workflow_files():
        wf_reports.append(upgrade_workflow(path, apply))
    report["workflows"] = wf_reports
    # 汇总统计（供脚本打印）
    report["summary"] = {
        "v1_remaining": sum(1 for r in wf_reports if r.get("version") == 1),
        "upgraded": sum(1 for r in wf_reports if r.get("action") == "upgraded"),
        "noop": sum(1 for r in wf_reports if r.get("action") == "noop"),
        "corrupt": sum(1 for r in wf_reports if r.get("action") == "skip-corrupt"),
    }
    return report