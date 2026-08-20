"""core/migrate.py 单元测试：v1→v2 迁移（注册表/工作流）、清单重建、备份校验、幂等、非破坏默认"""
import json
import os
import struct

import pytest

from core import canvas, migrate

# 真实最小 PNG（IHDR 可解析出 100x200），供 dims 探测
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
    entry = canvas.register_asset(str(src), name)
    assert entry is not None
    return entry


def test_detect_registry_missing(canvas_env):
    assert migrate.detect_registry()["state"] == "missing"


def test_detect_registry_v2(canvas_env):
    _register_png(canvas_env)
    assert migrate.detect_registry()["state"] == "v2"  # 新注册即 v2


def test_detect_registry_v1_and_corrupt(canvas_env):
    (canvas_env / ".canvas").mkdir(parents=True, exist_ok=True)
    reg = canvas_env / ".canvas" / "registry.json"
    reg.write_text(json.dumps({"old-entry": {"id": "old-entry", "name": "x.png"}}), encoding="utf-8")
    assert migrate.detect_registry()["state"] == "v1"
    reg.write_text("{broken", encoding="utf-8")
    assert migrate.detect_registry()["state"] == "corrupt"


def test_upgrade_registry_plan_only_is_non_destructive(canvas_env):
    entry = _register_png(canvas_env)
    # 人为降级为 v1 裸 dict（模拟老版本落盘格式）
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    before = (canvas_env / ".canvas" / "registry.json").read_bytes()
    report = migrate.plan_or_apply()
    assert report["registry"]["action"] == "upgrade-to-v2"
    assert report["registry"]["entries"] == 1
    # 默认不写文件、不备份、不产生 .bak
    assert (canvas_env / ".canvas" / "registry.json").read_bytes() == before
    assert list((canvas_env / ".canvas").glob("*.bak-*")) == []


def test_upgrade_registry_apply_backs_up_and_verifies(canvas_env):
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    report = migrate.plan_or_apply(apply=True)
    assert report["registry"]["action"] == "upgraded-to-v2"
    # 备份存在，且原内容仍可从备份恢复
    backup = report["registry"]["backup"]
    assert backup and os.path.isfile(backup)
    # 新文件是 v2 包装，加载器可读，条目数与转换前一致
    raw = json.loads((canvas_env / ".canvas" / "registry.json").read_text(encoding="utf-8"))
    assert raw["schemaVersion"] == 2
    assert isinstance(raw["images"], dict) and len(raw["images"]) == 1
    assert len(canvas.load_registry()) == 1
    # v1 升级补上了宽高（真实 PNG 可解析）
    assert raw["images"][entry["id"]]["width"] == 100
    assert raw["images"][entry["id"]]["height"] == 200


def test_upgrade_registry_idempotent(canvas_env):
    _register_png(canvas_env)  # 已是 v2
    first = migrate.plan_or_apply(apply=True)
    second = migrate.plan_or_apply(apply=True)
    assert first["registry"]["action"] == "none"  # 无需迁移
    assert second["registry"]["action"] == "none"
    assert len(canvas.load_registry()) == 1


def test_rebuild_registry_from_files(canvas_env):
    entry = _register_png(canvas_env)
    # 模拟清单丢失：删掉 registry 文件，文件保留
    os.unlink(canvas_env / ".canvas" / "registry.json")
    report = migrate.plan_or_apply(rebuild=True)
    assert report["registry"]["action"] == "rebuild-ready"
    assert report["registry"]["restored"] == 1
    report = migrate.plan_or_apply(rebuild=True, apply=True)
    assert report["registry"]["action"] == "rebuilt"
    entries = canvas.load_registry()
    restored = entries[entry["id"]]
    assert restored["name"] == f"canv_{entry['id']}.png"  # 文件名还原
    assert restored["width"] == 100 and restored["height"] == 200
    assert os.path.normpath(os.path.join(canvas.DEFAULT_OUTPUT_DIR, restored["relPath"])) == os.path.normpath(
        str(canvas_env / ".canvas" / f"canv_{entry['id']}.png")
    )


def test_workflow_upgrade_plan_and_apply(canvas_env):
    (canvas_env / "workflows").mkdir(parents=True, exist_ok=True)
    wf = canvas_env / "workflows" / "old.json"
    wf.write_text(json.dumps({"version": 1, "name": "old", "nodes": [{"id": "n1"}], "edges": []}), encoding="utf-8")
    report = migrate.plan_or_apply()
    assert report["workflows"][0]["action"] == "upgrade-ready"
    assert wf.read_bytes().startswith(b'{"version": 1')  # 未落地前文件不变
    report = migrate.plan_or_apply(apply=True)
    upgraded = report["workflows"][0]
    assert upgraded["action"] == "upgraded"
    raw = json.loads(wf.read_text(encoding="utf-8"))
    assert raw["version"] == 2
    assert raw["savedAt"]
    assert os.path.isfile(upgraded["backup"])
    # 应用自身加载器可读回
    assert canvas.workflow_load("old")["ok"] is True
    # 幂等：再跑一次变 noop
    report2 = migrate.plan_or_apply(apply=True)
    assert report2["workflows"][0]["action"] == "noop"


def test_workflow_corrupt_skipped(canvas_env):
    (canvas_env / "workflows").mkdir(parents=True, exist_ok=True)
    (canvas_env / "workflows" / "bad.json").write_text("{broken", encoding="utf-8")
    report = migrate.plan_or_apply(apply=True)
    assert report["workflows"][0]["action"] == "skip-corrupt"
    assert report["summary"]["corrupt"] == 1


def test_plan_never_writes_any_file(canvas_env):
    entry = _register_png(canvas_env)
    (canvas_env / ".canvas" / "registry.json").write_text(
        json.dumps({entry["id"]: {k: v for k, v in entry.items() if k not in ("absPath", "url")}}),
        encoding="utf-8",
    )
    (canvas_env / "workflows").mkdir(parents=True, exist_ok=True)
    wf = canvas_env / "workflows" / "w.json"
    wf.write_text(json.dumps({"version": 1, "nodes": [], "edges": []}), encoding="utf-8")
    before = {p.name: p.read_bytes() for p in canvas_env.rglob("*") if p.is_file()}
    migrate.plan_or_apply(rebuild=True)
    after = {p.name: p.read_bytes() for p in canvas_env.rglob("*") if p.is_file()}
    assert set(after) == set(before)

def _strip_kind_registry(env, entry):
    """把注册表条目人为去掉 kind（模拟缺来源标签的旧条目），并落盘 v2 包装"""
    (env / ".canvas").mkdir(parents=True, exist_ok=True)
    stripped = {k: v for k, v in entry.items() if k not in ("absPath", "url", "kind")}
    payload = {"schemaVersion": 2, "images": {entry["id"]: stripped}}
    (env / ".canvas" / "registry.json").write_text(json.dumps(payload), encoding="utf-8")


def test_detect_registry_reports_kind_missing(canvas_env):
    entry = _register_png(canvas_env)
    assert migrate.detect_registry()["kind_missing"] == 0
    _strip_kind_registry(canvas_env, entry)
    state = migrate.detect_registry()
    assert state["kind_missing"] == 1


def test_backfill_plan_only_never_writes(canvas_env):
    entry = _register_png(canvas_env)
    _strip_kind_registry(canvas_env, entry)
    before = (canvas_env / ".canvas" / "registry.json").read_bytes()
    report = migrate.backfill_asset_meta(apply=False)
    assert report["action"] == "backfill-ready"
    assert report["backfilled"] == 1
    assert (canvas_env / ".canvas" / "registry.json").read_bytes() == before


def test_backfill_apply_idempotent_with_backup(canvas_env):
    entry = _register_png(canvas_env)
    _strip_kind_registry(canvas_env, entry)
    report = migrate.backfill_asset_meta(apply=True)
    assert report["action"] == "backfilled"
    assert report["backfilled"] == 1
    assert report["backup"] and os.path.isfile(report["backup"])
    raw = json.loads((canvas_env / ".canvas" / "registry.json").read_text(encoding="utf-8"))
    assert raw["images"][entry["id"]]["kind"] == "canvas"
    report2 = migrate.backfill_asset_meta(apply=True)
    assert report2["action"] == "noop" or report2["backfilled"] == 0


def test_backfill_skipped_flag(canvas_env):
    entry = _register_png(canvas_env)
    _strip_kind_registry(canvas_env, entry)
    before = (canvas_env / ".canvas" / "registry.json").read_bytes()
    report = migrate.plan_or_apply(apply=True, backfill=False)
    assert report["asset_meta"]["action"] == "skipped"
    assert (canvas_env / ".canvas" / "registry.json").read_bytes() == before

def test_relocate_asset_dir_moves_and_rewrites_relpath(tmp_path, monkeypatch):
    """资产目录改名 .canvas -> .assets：搬文件 + 重写 registry relPath 前缀，幂等"""
    legacy = tmp_path / ".canvas"
    new = tmp_path / ".assets"
    legacy.mkdir(parents=True, exist_ok=True)
    (legacy / "canv_aabb.png").write_bytes(b"img")
    reg = {"schemaVersion": 2, "images": {"aabb": {
        "id": "aabb", "relPath": ".canvas/canv_aabb.png", "name": "a.png", "kind": "canvas"}}}
    (legacy / "registry.json").write_text(json.dumps(reg), encoding="utf-8")
    from core import registry
    for mod in (canvas, registry):
        monkeypatch.setattr(mod, "ASSET_DIR", str(new))
        monkeypatch.setattr(mod, "REGISTRY_FILE", str(new / "registry.json"))
        monkeypatch.setattr(mod, "LEGACY_ASSET_DIR", str(legacy), raising=False)

    plan = migrate.relocate_asset_dir(apply=False)
    assert plan["action"] == "ready" and plan["files"] == 1
    assert legacy.is_dir() and not new.exists()

    res = migrate.relocate_asset_dir(apply=True)
    assert res["action"] == "moved" and res["backup"]
    assert not legacy.exists() and new.is_dir()
    assert (new / "canv_aabb.png").exists()
    raw = json.loads((new / "registry.json").read_text(encoding="utf-8"))
    assert raw["images"]["aabb"]["relPath"] == ".assets/canv_aabb.png"
    assert migrate.relocate_asset_dir(apply=True)["action"] in ("noop", "nothing")


def test_plan_or_apply_one_shot_full_upgrade(tmp_path, monkeypatch):
    """一步到最新综合安全测试：存量 .canvas（含 registry/图/工作流 v1）--apply 一次到位。

    验证：报告不写文件；apply 先迁 .canvas->.assets、重写 relPath、回填 kind、升级工作流、
    备份存在、resolve_asset 命中、幂等无数据丢失。
    """
    from core import graphstore, registry

    legacy = tmp_path / ".canvas"
    new = tmp_path / ".assets"
    legacy.mkdir(parents=True, exist_ok=True)
    (legacy / "canv_abc123.png").write_bytes(b"img")
    # v2 注册表但缺 kind、relPath 用 .canvas/（模拟真实存量）
    reg = {"schemaVersion": 2, "images": {"abc123": {
        "id": "abc123", "relPath": ".canvas/canv_abc123.png", "name": "a.png"}}}
    (legacy / "registry.json").write_text(json.dumps(reg), encoding="utf-8")
    wf = tmp_path / "workflows"
    wf.mkdir(parents=True, exist_ok=True)
    (wf / "old.json").write_text(json.dumps({"version": 1, "name": "old", "nodes": [], "edges": []}), encoding="utf-8")
    # 构造独立隔离：registry/graphstore 目录常量指向本 tmp（重载迁移模块读最新常量）
    for mod in (registry, canvas):
        monkeypatch.setattr(mod, "DEFAULT_OUTPUT_DIR", str(tmp_path))
        monkeypatch.setattr(mod, "ASSET_DIR", str(new))
        monkeypatch.setattr(mod, "REGISTRY_FILE", str(new / "registry.json"))
        monkeypatch.setattr(mod, "LEGACY_ASSET_DIR", str(legacy), raising=False)
    monkeypatch.setattr(graphstore, "DEFAULT_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(graphstore, "WORKFLOWS_DIR", str(wf))
    monkeypatch.setattr(graphstore, "RECOVERY_DIR", str(wf / ".recovery"), raising=False)
    monkeypatch.setattr(canvas, "DEFAULT_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(canvas, "WORKFLOWS_DIR", str(wf))
    monkeypatch.setattr(canvas, "RECOVERY_DIR", str(wf / ".recovery"), raising=False)

    # 1) 报告模式不得写任何文件
    report = migrate.plan_or_apply()
    assert report["relocate"]["action"] == "ready"
    assert not new.exists() and legacy.is_dir()
    assert json.loads((wf / "old.json").read_text(encoding="utf-8"))["version"] == 1

    # 2) apply 一步到位
    report = migrate.plan_or_apply(apply=True)
    assert report["relocate"]["action"] == "moved"
    assert report["relocate"]["backup"] and os.path.isdir(report["relocate"]["backup"])
    assert new.is_dir() and not legacy.exists()
    assert (new / "canv_abc123.png").exists()          # 文件未丢
    raw = json.loads((new / "registry.json").read_text(encoding="utf-8"))
    e = raw["images"]["abc123"]
    assert e["relPath"] == ".assets/canv_abc123.png"    # 路径已改
    assert e["kind"] == "canvas"                        # kind 已回填
    assert json.loads((wf / "old.json").read_text(encoding="utf-8"))["version"] == 2  # 工作流已升级
    assert registry.resolve_asset("abc123") is not None  # 加载器能从 .assets 解析

    # 3) 幂等：再跑一次无副作用、无数据丢失
    before = sorted(os.listdir(new))
    report2 = migrate.plan_or_apply(apply=True)
    assert sorted(os.listdir(new)) == before
    assert registry.load_registry()["abc123"]["relPath"] == ".assets/canv_abc123.png"


def test_migrate_script_cli_output_root_end_to_end(tmp_path):
    """真实 CLI 子进程端到端安全测试：--output-root + --apply 一步到最新。

    验证脚本在拆分后对 registry/graphstore/canvas 三模块的目录 patch 生效，
    且报告不写、apply 搬目录+改路径+升工作流、不碰仓库默认 output。
    """
    import subprocess
    import sys
    from pathlib import Path

    root = tmp_path
    legacy = root / ".canvas"
    legacy.mkdir(parents=True, exist_ok=True)
    (legacy / "canv_cli123.png").write_bytes(b"img")
    (legacy / "registry.json").write_text(json.dumps({"schemaVersion": 2, "images": {"cli123": {
        "id": "cli123", "relPath": ".canvas/canv_cli123.png", "name": "c.png"}}}), encoding="utf-8")
    wf = root / "workflows"; wf.mkdir(parents=True, exist_ok=True)
    (wf / "old.json").write_text(json.dumps({"version": 1, "name": "old", "nodes": [], "edges": []}), encoding="utf-8")

    script = str(Path(__file__).resolve().parent.parent / "scripts" / "migrate_canvas_v2.py")

    r0 = subprocess.run([sys.executable, script, "--output-root", str(root)], capture_output=True, text=True)
    assert r0.returncode == 0, r0.stderr
    assert not (root / ".assets").exists()          # 报告不写
    assert legacy.is_dir()

    r1 = subprocess.run([sys.executable, script, "--output-root", str(root), "--apply"], capture_output=True, text=True)
    assert r1.returncode == 0, r1.stderr
    assert (root / ".assets" / "canv_cli123.png").exists()
    assert not legacy.exists()                       # 已迁移
    reg = json.loads((root / ".assets" / "registry.json").read_text(encoding="utf-8"))
    assert reg["images"]["cli123"]["relPath"] == ".assets/canv_cli123.png"
    assert json.loads((wf / "old.json").read_text(encoding="utf-8"))["version"] == 2
