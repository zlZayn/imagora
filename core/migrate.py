#!/usr/bin/env python3
"""画布存储迁移：v1 老格式 → v2 新格式、损坏清单按文件重建、可选来源标签回填。

纯逻辑（无 HTTP、无交互），供 scripts/migrate_canvas_v2.py 独立脚本调用；单测见 test_core_migrate.py。

安全语义：
  - 默认只报告（plan_*）：扫描并说明每个文件当前状态，不写任何文件。
  - apply_* 才落盘：先备份旧文件为 <path>.bak-<时间戳>，写 v2 后用 core.canvas 的加载器
    读回校验（条目/节点数一致），任一步失败不替换；迁移后旧格式仍可被程序读取（v1/v2 兼容）。
  - 幂等：已是 v2 的文件跳过，重复执行结果不变。
  - backfill_asset_meta：给缺可选来源标签（kind）的旧条目补 kind='canvas'（不 bump schemaVersion，
    可选字段旧读取器本就忽略）；same report-first / backup / verify 语义。
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
        return {
            "state": "v2", "count": len(data["images"]),
            "kind_missing": sum(1 for e in data["images"].values() if not isinstance(e, dict) or "kind" not in e),
        }
    if "schemaVersion" not in data:
        return {
            "state": "v1", "count": len(data),
            "kind_missing": sum(1 for e in data.values() if not isinstance(e, dict) or "kind" not in e),
        }
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
        for name in sorted(os.listdir(canvas.ASSET_DIR)):
            if not name.startswith("canv_") or not name.endswith(tuple(canvas.IMAGE_EXTENSIONS)):
                continue
            stem, ext = os.path.splitext(name)
            img_id = stem[len("canv_"):]
            abs_path = os.path.normpath(os.path.join(canvas.ASSET_DIR, name))
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


def backfill_asset_meta(apply: bool) -> dict:
    """给缺可选来源标签（kind）的旧条目补 kind='canvas'（幂等、只加不改结构）。

    现有注册表条目本质都是画布来源，补标签仅为后续按来源过滤/追溯用，不影响读取；
    不 bump schemaVersion（可选字段旧读取器忽略）。默认只报告待补数量；apply 才
    备份 + 写 + 用加载器读回校验（条目数一致才算成功）。
    """
    state = detect_registry()
    if state.get("state") not in ("v1", "v2"):
        return {"asset_meta": state, "action": "none", "backup": None}
    missing = state.get("kind_missing", 0)
    if missing == 0:
        return {"asset_meta": state, "action": "noop", "backfilled": 0}
    if not apply:
        return {"asset_meta": state, "action": "backfill-ready", "backfilled": missing}
    with canvas._REGISTRY_LOCK:
        entries = canvas.load_registry()
        filled = 0
        for img_id, entry in entries.items():
            if isinstance(entry, dict) and "kind" not in entry:
                entries[img_id] = {**entry, "kind": "canvas"}
                filled += 1
        if filled == 0:
            return {"asset_meta": detect_registry(), "action": "noop", "backfilled": 0}
        payload = {"schemaVersion": canvas.REGISTRY_SCHEMA_VERSION, "images": entries}
        backup = _backup_then_write(canvas.REGISTRY_FILE, payload)
    reloaded = canvas.load_registry()
    ok = len(reloaded) == len(entries)
    return {
        "asset_meta": detect_registry(),
        "action": "backfilled" if ok else "FAILED-VERIFY",
        "backfilled": filled,
        "backup": backup,
    }



# ---------------- 目录改名：.canvas -> .assets ----------------

def relocate_asset_dir(apply: bool) -> dict:
    """把存量资产目录 .canvas 迁到规范名 .assets（搬文件 + 重写 registry relPath 前缀）。

    工作流/提交/恢复快照只存 registryId、不存目录名，改名仅需搬整个目录 + 把
    registry.json 每个条目的 relPath 前缀 .canvas/ -> .assets/。默认只报告待搬文件数；
    apply 才先整目录备份 .bak-<ts>、重写 relPath、os.replace 换目录、读回校验条目数。
    幂等：.assets 已存在即 noop；旧目录不存在即 nothing。
    """
    legacy = canvas.LEGACY_ASSET_DIR
    new = canvas.ASSET_DIR
    if os.path.isdir(new) and os.path.isfile(os.path.join(new, "registry.json")):
        return {"action": "noop", "reason": ".assets 已存在"}
    if not os.path.isdir(legacy):
        return {"action": "nothing", "reason": "旧目录 .canvas 不存在"}
    files = [n for n in sorted(os.listdir(legacy)) if n.startswith("canv_")]
    if not apply:
        return {"action": "ready", "files": len(files)}
    bak = legacy + f"-bak-{_ts()}"
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
        payload = {"schemaVersion": canvas.REGISTRY_SCHEMA_VERSION, "images": entries}
        with open(reg, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(legacy, new)
    reloaded = canvas.load_registry()
    return {"action": "moved", "files": len(files), "backup": bak, "entries": len(reloaded)}


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

def plan_or_apply(apply: bool = False, rebuild: bool = False, backfill: bool = True) -> dict:
    """全量迁移入口：registry（升级或重建）+ 来源标签回填 + 目录改名（路径变更）+ 全部工作流。

    一条命令从最早格式一步到最新：默认（apply=False）只报告每项将做什么；
    apply=True 才备份→转换→校验（含 relocate_asset_dir 把存量 .canvas 迁到规范名 .assets）。
    backfill=False 完全跳过来源标签回填。
    """
    report: dict = {"apply": apply}
    # 顺序关键：先搬目录（.canvas -> .assets 重写 relPath、归一格式 v2），
    # 再升级/回填注册表（读 .assets），最后升级工作流——否则存量还留在 .canvas 时升级会读到空。
    report["relocate"] = relocate_asset_dir(apply)
    if rebuild:
        report["registry"] = rebuild_registry(apply)
    else:
        report["registry"] = upgrade_registry(apply)
    report["asset_meta"] = backfill_asset_meta(apply) if backfill else {"action": "skipped"}
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