"""core.registry / core.graphstore 迁移测试：注册表(v1→v2/重建/回填/迁目录) + 工作流(v1→v2) + CLI 整链。

迁移逻辑已各归其位：注册表迁移在 core.registry（registry.migrate 协调 relocate+upgrade/rebuild+backfill），
工作流迁移在 core.graphstore（migrate_workflows）。脚本 scripts/migrate.py 只做协调与打印。
"""
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import pytest

from core import canvas, graphstore, registry

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    + b"\x00\x00\x00\x0dIHDR"
    + struct.pack(">II", 100, 200)
    + b"\x08\x06\x00\x00\x00"
    + b"\x00" * 4
)


@pytest.fixture
def canvas_env(asset_iso):
    return asset_iso


def _register_png(env, name="a.png"):
    (env / ".canvas").mkdir(parents=True, exist_ok=True)
    src = env / name
    src.write_bytes(PNG_BYTES + name.encode())
    entry = registry.register_asset(str(src), name)
    assert entry is not None
    return entry


def _wc(name="w.json"):
    p = Path(canvas.DEFAULT_OUTPUT_DIR) / "workflows"
    p.mkdir(parents=True, exist_ok=True)
    return p / name


# ---------- 注册表：detect ----------

def test_detect_registry_missing(canvas_env):
    assert registry.detect_registry()["state"] == "missing"


def test_detect_registry_v2(canvas_env):
    _register_png(canvas_env)
    assert registry.detect_registry()["state"] == "v2"


def test_detect_registry_v1_and_corrupt(canvas_env):
    (canvas_env / ".canvas").mkdir(parents=True, exist_ok=True)
    reg = canvas_env / ".canvas" / "registry.json"
    reg.write_text(json.dumps({"old-entry": {"id": "old-entry", "name": "x.png"}}), encoding="utf-8")
    assert registry.detect_registry()["state"] == "v1"
    reg.write_text("{broken", encoding="utf-8")
    assert registry.detect_registry()["state"] == "corrupt"


# ---------- 注册表：升级 v1->v2 ----------

def test_upgrade_registry_plan_only_is_non_destructive(canvas_env):
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    report = registry.migrate()
    assert report["registry"]["action"] == "upgrade-to-v2"
    raw = json.loads((canvas_env / ".canvas" / "registry.json").read_bytes())
    assert "schemaVersion" not in raw


def test_upgrade_registry_apply_backs_up_and_verifies(canvas_env):
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    report = registry.migrate(apply=True)
    assert report["registry"]["action"] == "upgraded-to-v2"
    assert report["registry"]["backup"] and os.path.isfile(report["registry"]["backup"])
    raw = json.loads((canvas_env / ".canvas" / "registry.json").read_text(encoding="utf-8"))
    assert raw["schemaVersion"] == 2
    assert canvas.load_registry()[entry["id"]]["id"] == entry["id"]


def test_upgrade_registry_idempotent(canvas_env):
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    registry.migrate(apply=True)
    first = registry.migrate(apply=True)
    assert first["registry"]["action"] == "none"
    assert registry.migrate(apply=True)["registry"]["action"] == "none"


def test_rebuild_registry_from_files(canvas_env):
    entry = _register_png(canvas_env)
    os.unlink(canvas_env / ".canvas" / "registry.json")
    report = registry.migrate(rebuild=True)
    assert report["registry"]["action"] == "rebuild-ready"
    assert report["registry"]["restored"] == 1
    report = registry.migrate(rebuild=True, apply=True)
    assert report["registry"]["action"] == "rebuilt"
    restored = canvas.load_registry()[entry["id"]]
    assert restored["name"] == f"canv_{entry['id']}.png"
    assert restored["width"] == 100 and restored["height"] == 200


def test_upgrade_reports_pending_relocate_when_legacy_has_v1(canvas_env):
    """dry-run：.canvas/registry.json 是 v1 裸清单但还没搬到 .assets 时，
    upgrade_registry 应返回 'pending-relocate' 提示待迁后升级，避免误报 missing/noop。"""
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    # .assets 还不存在（没搬过），主路径 detect 返回 missing；upgrade 应去 legacy 探测
    assert not (canvas_env / ".assets").exists()
    report = registry.upgrade_registry(apply=False)
    assert report["registry"]["state"] == "v1"
    assert report["action"] == "pending-relocate"
    assert report["entries"] == 1
    # dry-run 不写任何文件
    assert not (canvas_env / ".assets").exists()
    assert (canvas_env / ".canvas" / "registry.json").read_text(encoding="utf-8").startswith("{")


def test_upgrade_pending_relocate_clears_after_apply(canvas_env):
    """apply 后 .canvas 搬到 .assets，pending-relocate 消失，再 dry-run 显示 v2/noop。"""
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    assert registry.upgrade_registry(apply=False)["action"] == "pending-relocate"
    # 一步 apply（relocate 把 .canvas 搬到 .assets，legacy 下的清单随之就位）
    registry.migrate(apply=True)
    assert registry.upgrade_registry(apply=False)["action"] == "none"
    raw = json.loads((canvas_env / ".assets" / "registry.json").read_text(encoding="utf-8"))
    assert raw["schemaVersion"] == 2 and raw["images"][entry["id"]]["kind"] == "canvas"


# ---------- 工作流：升级 v1->v2 ----------

def test_workflow_upgrade_plan_and_apply(canvas_env):
    wf = _wc("old.json")
    wf.write_text(json.dumps({"version": 1, "name": "old", "nodes": [{"id": "n1"}], "edges": []}), encoding="utf-8")
    report = graphstore.migrate_workflows()
    assert report["workflows"][0]["action"] == "upgrade-ready"
    assert wf.read_bytes().startswith(b'{"version": 1')
    report = graphstore.migrate_workflows(apply=True)
    upgraded = report["workflows"][0]
    assert upgraded["action"] == "upgraded"
    raw = json.loads(wf.read_text(encoding="utf-8"))
    assert raw["version"] == 2 and raw["savedAt"]
    assert os.path.isfile(upgraded["backup"])
    assert canvas.workflow_load("old")["ok"] is True
    assert graphstore.migrate_workflows(apply=True)["workflows"][0]["action"] == "noop"


def test_workflow_corrupt_skipped(canvas_env):
    wf = _wc("bad.json")
    wf.write_text("{broken", encoding="utf-8")
    report = graphstore.migrate_workflows(apply=True)
    assert report["workflows"][0]["action"] == "skip-corrupt"
    assert report["summary"]["corrupt"] == 1


def test_plan_never_writes_any_file(canvas_env):
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    _wc("w.json").write_text(json.dumps({"version": 1, "nodes": [], "edges": []}), encoding="utf-8")
    before = {p.name: p.read_bytes() for p in canvas_env.rglob("*") if p.is_file()}
    registry.migrate(rebuild=True)
    graphstore.migrate_workflows()
    after = {p.name: p.read_bytes() for p in canvas_env.rglob("*") if p.is_file()}
    assert set(after) == set(before)


# ---------- 来源标签回填 ----------

def _strip_kind_registry(env, entry):
    (env / ".canvas").mkdir(parents=True, exist_ok=True)
    stripped = {k: v for k, v in entry.items() if k not in ("absPath", "url", "kind")}
    payload = {"schemaVersion": 2, "images": {entry["id"]: stripped}}
    (env / ".canvas" / "registry.json").write_text(json.dumps(payload), encoding="utf-8")


def test_detect_registry_reports_kind_missing(canvas_env):
    entry = _register_png(canvas_env)
    assert registry.detect_registry()["kind_missing"] == 0
    _strip_kind_registry(canvas_env, entry)
    assert registry.detect_registry()["kind_missing"] == 1


def test_backfill_plan_only_never_writes(canvas_env):
    entry = _register_png(canvas_env)
    _strip_kind_registry(canvas_env, entry)
    before = (canvas_env / ".canvas" / "registry.json").read_bytes()
    report = registry.backfill_asset_meta(apply=False)
    assert report["action"] == "backfill-ready" and report["backfilled"] == 1
    assert (canvas_env / ".canvas" / "registry.json").read_bytes() == before


def test_backfill_apply_idempotent_with_backup(canvas_env):
    entry = _register_png(canvas_env)
    _strip_kind_registry(canvas_env, entry)
    report = registry.backfill_asset_meta(apply=True)
    assert report["action"] == "backfilled" and report["backfilled"] == 1
    assert os.path.isfile(report["backup"])
    raw = json.loads((canvas_env / ".canvas" / "registry.json").read_text(encoding="utf-8"))
    assert raw["images"][entry["id"]]["kind"] == "canvas"
    assert registry.detect_registry()["kind_missing"] == 0


def test_backfill_skipped_flag(canvas_env):
    entry = _register_png(canvas_env)
    _strip_kind_registry(canvas_env, entry)
    before = (canvas_env / ".canvas" / "registry.json").read_bytes()
    report = registry.migrate(apply=True, backfill=False)
    assert report["asset_meta"]["action"] == "skipped"
    assert (canvas_env / ".canvas" / "registry.json").read_bytes() == before


# ---------- 目录改名 .canvas -> .assets ----------

def test_relocate_asset_dir_moves_and_rewrites_relpath(tmp_path, monkeypatch):
    legacy = tmp_path / ".canvas"
    new = tmp_path / ".assets"
    legacy.mkdir(parents=True, exist_ok=True)
    (legacy / "canv_aabb.png").write_bytes(b"img")
    (legacy / "registry.json").write_text(json.dumps({"schemaVersion": 2, "images": {"aabb": {"relPath": ".canvas/canv_aabb.png"}}}), encoding="utf-8")
    for mod in (registry, canvas):
        monkeypatch.setattr(mod, "ASSET_DIR", str(new))
        monkeypatch.setattr(mod, "REGISTRY_FILE", str(new / "registry.json"))
        monkeypatch.setattr(mod, "LEGACY_ASSET_DIR", str(legacy), raising=False)
    plan = registry.relocate_asset_dir(apply=False)
    assert plan["action"] == "ready" and plan["files"] == 1
    assert legacy.is_dir() and not new.exists()
    res = registry.relocate_asset_dir(apply=True)
    assert res["action"] == "moved"
    assert not legacy.exists() and new.is_dir()
    assert (new / "canv_aabb.png").exists()
    reg = json.loads((new / "registry.json").read_text(encoding="utf-8"))
    assert reg["images"]["aabb"]["relPath"] == ".assets/canv_aabb.png"
    assert registry.relocate_asset_dir(apply=True)["action"] in ("noop", "nothing")


# ---------- 一步到最新综合 ----------

def test_migrate_one_shot_full_upgrade(tmp_path, monkeypatch):
    legacy = tmp_path / ".canvas"; legacy.mkdir(parents=True, exist_ok=True)
    (legacy / "canv_abc123.png").write_bytes(b"img")
    (legacy / "registry.json").write_text(json.dumps({"schemaVersion": 2, "images": {"abc123": {"relPath": ".canvas/canv_abc123.png"}}}), encoding="utf-8")
    wf = tmp_path / "workflows"; wf.mkdir(parents=True, exist_ok=True)
    (wf / "old.json").write_text(json.dumps({"version": 1, "name": "old", "nodes": [], "edges": []}), encoding="utf-8")
    for mod in (registry, canvas):
        monkeypatch.setattr(mod, "DEFAULT_OUTPUT_DIR", str(tmp_path))
        monkeypatch.setattr(mod, "ASSET_DIR", str(tmp_path / ".assets"))
        monkeypatch.setattr(mod, "REGISTRY_FILE", str(tmp_path / ".assets" / "registry.json"))
        monkeypatch.setattr(mod, "LEGACY_ASSET_DIR", str(legacy), raising=False)
    for mod in (graphstore, canvas):
        monkeypatch.setattr(mod, "DEFAULT_OUTPUT_DIR", str(tmp_path))
        monkeypatch.setattr(mod, "WORKFLOWS_DIR", str(wf))
        monkeypatch.setattr(mod, "RECOVERY_DIR", str(wf / ".recovery"), raising=False)
    rr = registry.migrate()
    assert rr["relocate"]["action"] == "ready"
    gr = graphstore.migrate_workflows()
    assert gr["workflows"][0]["action"] == "upgrade-ready"
    assert legacy.is_dir() and not (tmp_path / ".assets").exists()
    rr = registry.migrate(apply=True)
    assert rr["relocate"]["action"] == "moved"
    assert (tmp_path / ".assets").is_dir() and not legacy.exists()
    reg = json.loads((tmp_path / ".assets" / "registry.json").read_text(encoding="utf-8"))
    assert reg["images"]["abc123"]["relPath"] == ".assets/canv_abc123.png"
    assert registry.resolve_asset("abc123") is not None
    gr = graphstore.migrate_workflows(apply=True)
    assert gr["workflows"][0]["action"] == "upgraded"
    assert json.loads((wf / "old.json").read_text(encoding="utf-8"))["version"] == 2


def test_migrate_script_cli_output_root_end_to_end(tmp_path):
    root = tmp_path
    legacy = root / ".canvas"; legacy.mkdir(parents=True, exist_ok=True)
    (legacy / "canv_cli123.png").write_bytes(b"img")
    (legacy / "registry.json").write_text(json.dumps({"schemaVersion": 2, "images": {"cli123": {"relPath": ".canvas/canv_cli123.png"}}}), encoding="utf-8")
    wf = root / "workflows"; wf.mkdir(parents=True, exist_ok=True)
    (wf / "old.json").write_text(json.dumps({"version": 1, "name": "old"}), encoding="utf-8")
    script = str(Path(__file__).resolve().parent.parent / "scripts" / "migrate.py")
    r0 = subprocess.run([sys.executable, script, "--output-root", str(root)], capture_output=True, text=True)
    assert r0.returncode == 0, r0.stderr
    assert not (root / ".assets").exists()
    r1 = subprocess.run([sys.executable, script, "--output-root", str(root), "--apply"], capture_output=True, text=True)
    assert r1.returncode == 0, r1.stderr
    assert (root / ".assets" / "canv_cli123.png").exists()
    reg = json.loads((root / ".assets" / "registry.json").read_text(encoding="utf-8"))
    assert reg["images"]["cli123"]["relPath"] == ".assets/canv_cli123.png"
    assert json.loads((wf / "old.json").read_text(encoding="utf-8"))["version"] == 2
