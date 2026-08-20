#!/usr/bin/env python3
"""图/工作流存储（graphstore）：工作流、提交图快照、恢复快照。
图片节点只存 registryId，路径由 core.registry.resolve_asset 实时重建。
原为 core/canvas.py 的一部分，现拆出。
"""
import json
import os
import re
import threading
import time
from core.config import DEFAULT_OUTPUT_DIR
from core.registry import resolve_asset


SUBMISSIONS_DIR = os.path.join(DEFAULT_OUTPUT_DIR, "submissions")

WORKFLOWS_DIR = os.path.join(DEFAULT_OUTPUT_DIR, "workflows")

RECOVERY_DIR = os.path.join(WORKFLOWS_DIR, ".recovery")

RECOVERY_LIMIT = 20

_RECOVERY_LOCK = threading.Lock()

_RECOVERY_SEQUENCE = 0

WORKFLOW_VERSION = 2

WORKFLOW_LOAD_VERSIONS = (1, 2)

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

def _resolve_image_node_paths(nodes: list) -> list[str]:
    """加载工作流时按 registryId 统一解析图片节点（单一事实来源）。

    就地更新每个图片节点 data：registry 命中且文件存在 → 重新推导当前真实
    absPath 与 url（registry 用相对路径，项目目录改名后仍有效，旧快照自愈）；
    否则该 registryId 进 missing（节点保持无 url/absPath，前端占位标红）。
    返回 missing 列表。
    """
    missing: list[str] = []
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") != "image":
            continue
        data_part = node.get("data")
        if not isinstance(data_part, dict):
            continue
        reg_id = str(data_part.get("registryId", ""))
        resolved = resolve_asset(reg_id)
        if not resolved:
            missing.append(reg_id)
            continue
        data_part["absPath"] = resolved["absPath"]
        data_part["url"] = resolved["url"]
    return missing

def _strip_derived_node_paths(nodes: list) -> list:
    """落盘前归一化：图片节点只保留 registryId + 元数据，剥离派生路径（url/absPath）。

    返回新列表（不修改入参）：非图片节点原样引用，图片节点复制 data 后剔除
    url/absPath——保证磁盘工作流是规范数据，加载时由 _resolve_image_node_paths 重建。
    """
    normalized: list = []
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") != "image":
            normalized.append(node)
            continue
        data_part = node.get("data")
        if not isinstance(data_part, dict):
            normalized.append(node)
            continue
        clean = {k: v for k, v in data_part.items() if k not in ("url", "absPath")}
        normalized.append({**node, "data": clean})
    return normalized

def workflow_save(name: str, nodes: list, edges: list) -> dict:
    """保存工作流为 JSON 文件（固定目录 output/workflows/<name>.json，version 2）。

    图片节点落盘前归一化（_strip_derived_node_paths）：只存 registryId + 元数据，
    不存派生路径 url/absPath——加载时由 _resolve_image_node_paths 实时重建，
    项目目录改名/移动后旧存档依然可恢复。原子写（先临时文件再替换），多窗口不会写坏。
    返回 {"ok": True, "path"} 或 {"ok": False, "error"}。
    """
    filename = sanitize_workflow_name(name)
    if not filename:
        return {"ok": False, "error": "工作流名不合法（不能含路径分隔符）"}
    abs_path = os.path.join(WORKFLOWS_DIR, f"{filename}.json")
    try:
        os.makedirs(WORKFLOWS_DIR, exist_ok=True)
        payload = {
            "version": WORKFLOW_VERSION,
            "name": filename,
            "savedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "nodes": _strip_derived_node_paths(nodes),
            "edges": edges,
        }
        _atomic_write_json(abs_path, payload)
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
    """加载工作流 JSON：校验版本（v1/v2 均支持）、按 registryId 实时解析图片节点路径。

    图片节点经 _resolve_image_node_paths 统一解析（registry → relPath → absPath/url，
    不信任存档里的旧绝对路径）；registry 缺失或文件不存在的 registryId 进 missing
    （节点保持无路径，前端占位标红）。未知版本明确拒绝（不按错误结构解析未来格式）。
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
    if not isinstance(data, dict):
        return {"ok": False, "error": "工作流结构非法"}
    version = data.get("version")
    if version not in WORKFLOW_LOAD_VERSIONS:
        return {"ok": False, "error": f"不支持的版本（{version}），仅支持 v{'/v'.join(str(v) for v in WORKFLOW_LOAD_VERSIONS)}"}
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return {"ok": False, "error": "工作流结构非法"}
    return {
        "ok": True,
        "name": str(data.get("name", "")),
        "nodes": nodes,
        "edges": edges,
        "missing": _resolve_image_node_paths(nodes),
    }

def _safe_submission_id(submission_id: str) -> bool:
    """提交 id 白名单：仅字母/数字/短横线/下划线（内部生成，防御性校验防路径穿越）"""
    return bool(submission_id) and bool(re.fullmatch(r"[A-Za-z0-9_-]+", submission_id))

def submission_save(
    submission_id: str,
    prompt: str,
    params: dict,
    input_assets: list[dict],
    result_assets: list[dict],
    win: int = 0,
) -> dict:
    """把一次经典生成落成一份提交图快照（复用工作流格式，kind='submission'）。

    结构：可选图片组节点收拢输入参考图 → 提示词卡片 → 结果图节点；连线组→提示词→结果。
    图片节点只存 registryId + 元数据（url/absPath 由加载时 _resolve_image_node_paths 重建）。
    写 output/submissions/<submission_id>.json，原子写；失败返回 {"ok":False,"error"}。
    """
    if not _safe_submission_id(submission_id):
        return {"ok": False, "error": "提交 id 不合法"}
    prompt_id = f"prompt-{submission_id}"
    group_id = f"group-{submission_id}"

    def _img(node_id: str, asset: dict) -> dict:
        return {
            "id": node_id,
            "type": "image",
            "position": {"x": 0, "y": 0},
            "data": {
                "registryId": asset["id"],
                "name": asset.get("name", ""),
                "size": asset.get("size", 0),
                "ext": asset.get("ext", ""),
                "refCount": 0,
            },
        }

    nodes: list[dict] = []
    edges: list[dict] = []
    prompt_node = {
        "id": prompt_id,
        "type": "prompt",
        "position": {"x": 0, "y": 0},
        "data": {
            "prompt": prompt,
            "size": params.get("size", ""),
            "quality": params.get("quality", ""),
            "outputDir": params.get("outputDir", ""),
            "status": "idle",
        },
    }
    nodes.append(prompt_node)

    use_group = bool(input_assets)
    group_member_ids: list[str] = []
    for i, asset in enumerate(input_assets):
        nid = f"img-{asset['id']}"
        nodes.append(_img(nid, asset))
        group_member_ids.append(nid)
    if use_group:
        nodes.append({"id": group_id, "type": "group", "position": {"x": 0, "y": 0},
                      "data": {"name": "图片组", "imageCount": len(input_assets),
                               "totalSize": sum(a.get("size", 0) for a in input_assets)}})
        for nid in group_member_ids:
            edges.append({"id": f"{nid}->{group_id}", "source": nid, "target": group_id})
        edges.append({"id": f"{group_id}->{prompt_id}", "source": group_id, "target": prompt_id})

    for asset in result_assets:
        nid = f"img-{asset['id']}"
        nodes.append(_img(nid, asset))
        edges.append({"id": f"{prompt_id}->{nid}", "source": prompt_id, "target": nid})

    path = os.path.join(SUBMISSIONS_DIR, f"{submission_id}.json")
    payload = {
        "version": WORKFLOW_VERSION,
        "kind": "submission",
        "name": f"classic-{submission_id}",
        "savedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "meta": {"submissionId": submission_id, "sourceMode": "classic", "win": win},
        "nodes": _strip_derived_node_paths(nodes),
        "edges": edges,
    }
    try:
        os.makedirs(SUBMISSIONS_DIR, exist_ok=True)
        _atomic_write_json(path, payload)
        return {"ok": True, "path": path}
    except (OSError, TypeError, ValueError) as e:
        return {"ok": False, "error": str(e)}

def submission_load(submission_id: str) -> dict:
    """读取提交图快照并按注册表实时解析图片节点路径（同 workflow_load 规则）。

    校验版本（v1/v2）与 kind='submission'；缺失资产进 missing。
    返回 {"ok":True,"name","nodes","edges","missing"} 或 {"ok":False,"error"}。
    """
    if not _safe_submission_id(submission_id):
        return {"ok": False, "error": "提交 id 不合法"}
    path = os.path.join(SUBMISSIONS_DIR, f"{submission_id}.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return {"ok": False, "error": f"读取失败: {e}"}
    if not isinstance(data, dict) or data.get("kind") != "submission":
        return {"ok": False, "error": "不是提交图快照"}
    version = data.get("version")
    if version not in WORKFLOW_LOAD_VERSIONS:
        return {"ok": False, "error": f"不支持的版本（{version}）"}
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return {"ok": False, "error": "提交图快照结构非法"}
    return {
        "ok": True,
        "name": str(data.get("name", "")),
        "nodes": nodes,
        "edges": edges,
        "missing": _resolve_image_node_paths(nodes),
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
    """创建独立恢复快照并轮转；永不写入手动工作流文件。

    与 workflow_save 同规则：图片节点归一化落盘（不存派生路径），加载时重建。
    """
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return {"ok": False, "error": "恢复快照结构非法"}
    try:
        with _RECOVERY_LOCK:
            global _RECOVERY_SEQUENCE
            _RECOVERY_SEQUENCE += 1
            saved_at = time.strftime("%Y-%m-%d %H:%M:%S")
            name = f"recovery_{time.time_ns()}_{_RECOVERY_SEQUENCE:04d}"
            path = os.path.join(RECOVERY_DIR, f"{name}.json")
            payload = {
                "version": WORKFLOW_VERSION,
                "name": name,
                "savedAt": saved_at,
                "nodes": _strip_derived_node_paths(nodes),
                "edges": edges,
            }
            os.makedirs(RECOVERY_DIR, exist_ok=True)
            _atomic_write_json(path, payload)
            _prune_recovery_snapshots(RECOVERY_LIMIT)
        return {"ok": True, "path": path, "name": name, "savedAt": saved_at}
    except (OSError, TypeError, ValueError) as e:
        return {"ok": False, "error": str(e)}

def recovery_latest() -> dict:
    """读取最近一份可用恢复快照；损坏文件自动跳过。

    图片节点同样经 _resolve_image_node_paths 实时解析（同 workflow_load 规则）。
    """
    for path in _recovery_paths():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or data.get("version") not in WORKFLOW_LOAD_VERSIONS:
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
            "missing": _resolve_image_node_paths(nodes),
        }
    return {"ok": False, "empty": True}


# ================= 工作流迁移（graphstore 自带） =================

def workflow_files(pattern: str = ".json") -> list[str]:
    """工作流目录下匹配扩展名（含 .json）的文件绝对路径列表。"""
    try:
        names = [n for n in os.listdir(WORKFLOWS_DIR) if n.endswith(pattern)]
    except OSError:
        return []
    return [os.path.join(WORKFLOWS_DIR, n) for n in sorted(names)]


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
    if version == WORKFLOW_VERSION:
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
    payload = {**data, "version": WORKFLOW_VERSION, "savedAt": saved_at}
    backup = _atomic_write_workflow_backup(path, payload)
    result = workflow_load(name)
    nodes_ok = result.get("ok") is True and len(result.get("nodes", [])) == len(data.get("nodes", []))
    return {
        "name": name,
        "version": WORKFLOW_VERSION,
        "action": "upgraded" if nodes_ok else "FAILED-VERIFY",
        "backup": backup,
    }


def _atomic_write_workflow_backup(path: str, payload: dict) -> str:
    """工作流迁移：备份旧文件 .bak-<ts> 后原子写新 payload（复用 graphstore._atomic_write_json 语义）。"""
    import shutil
    from core.registry import _mig_ts
    backup = None
    if os.path.isfile(path):
        backup = f"{path}.bak-{_mig_ts()}"
        shutil.copy2(path, backup)
    base = os.path.splitext(path)[0]
    tmp = f"{base}.{os.getpid()}-{time.time_ns()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    return backup


def migrate_workflows(apply: bool = False) -> dict:
    """工作流一步升级到最新：逐文件 v1→v2（备份+校验）。返回 {workflows:[...], summary}。

    summary 同时统计 ready（dry-run 时检测到的待升级 v1）和 upgraded（apply 后实际升级），
    让 dry-run 报告也能显示"待升级 N"，不误报为 0。
    """
    wf_reports = []
    for path in workflow_files():
        wf_reports.append(upgrade_workflow(path, apply))
    return {
        "workflows": wf_reports,
        "summary": {
            "v1_remaining": sum(1 for r in wf_reports if r.get("version") == 1),
            "ready": sum(1 for r in wf_reports if r.get("action") == "upgrade-ready"),
            "upgraded": sum(1 for r in wf_reports if r.get("action") == "upgraded"),
            "noop": sum(1 for r in wf_reports if r.get("action") == "noop"),
            "corrupt": sum(1 for r in wf_reports if r.get("action") == "skip-corrupt"),
        },
    }
