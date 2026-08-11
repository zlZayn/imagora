"""core/canvas.py 单元测试：注册表读写/去重/导入校验/删除/列表/白名单（tmp 目录注入，零网络零计费）"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import canvas


@pytest.fixture
def canvas_env(tmp_path, monkeypatch):
    """把画布目录注入 tmp_path（模块常量需一并覆盖，DEFAULT_OUTPUT_DIR 不联动 CANVAS_DIR）"""
    monkeypatch.setattr(canvas, "DEFAULT_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(canvas, "CANVAS_DIR", str(tmp_path / ".canvas"))
    monkeypatch.setattr(canvas, "REGISTRY_FILE", str(tmp_path / ".canvas" / "registry.json"))
    monkeypatch.setattr(canvas, "WORKFLOWS_DIR", str(tmp_path / "workflows"))
    monkeypatch.setattr(canvas, "RECOVERY_DIR", str(tmp_path / "workflows" / ".recovery"), raising=False)
    return tmp_path


def _write_png(path: Path, content: bytes = b"\x89PNG-fake") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _must(entry):
    """register_file 返回 dict|None，if-guard 收窄为 dict（basic 模式 assert 不缩小）"""
    if entry is None:
        pytest.fail("register_file 返回 None")
    return entry


def test_register_and_load(canvas_env):
    import hashlib

    content = b"\x89PNG-fake"
    src = _write_png(canvas_env / "a.png", content)
    entry = _must(canvas.register_file(str(src), "a.png"))
    assert entry is not None
    assert entry["id"] == hashlib.sha1(content).hexdigest()[:12]  # 内容 sha1 前缀
    assert entry["name"] == "a.png"
    assert entry["ext"] == "png"
    assert entry["size"] == len(content)
    assert entry["relPath"] == f".canvas/canv_{entry['id']}.png"
    assert (canvas_env / ".canvas" / f"canv_{entry['id']}.png").exists()
    # registry 落盘可读回（落盘条目不含 absPath/url，返回条目附带两者）
    entries = canvas.load_registry()
    stored = entries[entry["id"]]
    assert {k: v for k, v in entry.items() if k not in ("absPath", "url")} == stored
    assert entry["url"].startswith("/api/image?path=")
    assert entry["absPath"] == str(canvas_env / ".canvas" / f"canv_{entry['id']}.png")


def test_register_dedup_same_content(canvas_env):
    src1 = _write_png(canvas_env / "a.png", b"same")
    src2 = _write_png(canvas_env / "b.png", b"same")
    e1 = _must(canvas.register_file(str(src1), "a.png"))
    e2 = _must(canvas.register_file(str(src2), "b.png"))
    assert e1["id"] == e2["id"]
    canv_files = list((canvas_env / ".canvas").glob("canv_*"))
    assert len(canv_files) == 1  # 同内容只一个文件


def test_register_different_content(canvas_env):
    e1 = _must(canvas.register_file(str(_write_png(canvas_env / "a.png", b"one")), "a.png"))
    e2 = _must(canvas.register_file(str(_write_png(canvas_env / "b.png", b"two")), "b.png"))
    assert e1["id"] != e2["id"]
    assert len(list((canvas_env / ".canvas").glob("canv_*"))) == 2


def test_register_nonexistent(canvas_env):
    assert canvas.register_file(str(canvas_env / "nope.png"), "nope.png") is None


def test_registry_corrupt_returns_empty(canvas_env):
    (canvas_env / ".canvas").mkdir(parents=True)
    (canvas_env / ".canvas" / "registry.json").write_text("{broken json", encoding="utf-8")
    assert canvas.load_registry() == {}


def test_import_directory_recursive(canvas_env):
    (canvas_env / "win1").mkdir(parents=True)
    _write_png(canvas_env / "win1" / "x.png")
    _write_png(canvas_env / "win1" / "sub" / "y.jpg", b"\xff\xd8fake")
    (canvas_env / "win1" / "readme.txt").write_text("no", encoding="utf-8")
    result = canvas.import_images([str(canvas_env / "win1")])
    assert len(result["imported"]) == 2  # txt 不导入
    assert result["skipped"] == []
    assert all(e["relPath"].startswith(".canvas/canv_") for e in result["imported"])


def test_import_single_file(canvas_env):
    src = _write_png(canvas_env / "single.png")
    result = canvas.import_images([str(src)])
    assert len(result["imported"]) == 1
    assert result["imported"][0]["name"] == "single.png"


def test_import_outside_output_rejected(canvas_env, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside")
    src = _write_png(outside / "evil.png")
    result = canvas.import_images([str(src)])
    assert result["imported"] == []
    assert result["skipped"][0]["path"] == str(src)
    assert "不在输出目录内" in result["skipped"][0]["reason"]


def test_import_missing_path_skipped(canvas_env):
    result = canvas.import_images([str(canvas_env / "ghost.png")])
    assert result["imported"] == []
    assert len(result["skipped"]) == 1  # 不抛异常


def test_import_non_image_file_skipped(canvas_env):
    txt = canvas_env / "notes.txt"
    txt.write_text("hi", encoding="utf-8")
    result = canvas.import_images([str(txt)])
    assert result["imported"] == []
    assert len(result["skipped"]) == 1


def test_delete_image(canvas_env):
    entry = _must(canvas.register_file(str(_write_png(canvas_env / "a.png")), "a.png"))
    assert canvas.delete_image(entry["id"]) is True
    assert entry["id"] not in canvas.load_registry()
    assert not (canvas_env / entry["relPath"]).exists()
    assert canvas.delete_image(entry["id"]) is False  # 再删返回 False


def test_delete_missing_file_tolerant(canvas_env):
    entry = _must(canvas.register_file(str(_write_png(canvas_env / "a.png")), "a.png"))
    (canvas_env / entry["relPath"]).unlink()  # 外部删了文件
    assert canvas.delete_image(entry["id"]) is True  # 注册表移除仍成功，不抛


def test_list_images_with_abs_path(canvas_env):
    canvas.register_file(str(_write_png(canvas_env / "a.png")), "a.png")
    images = canvas.list_images()
    assert len(images) == 1
    assert os.path.normpath(images[0]["absPath"]) == os.path.normpath(
        str(canvas_env / images[0]["relPath"])
    )
    assert os.path.isfile(images[0]["absPath"])


def test_safe_ref_path_allowlist(canvas_env):
    ref_root = str(canvas_env / ".refs")
    canv_root = str(canvas_env / ".canvas")
    (canvas_env / ".refs").mkdir()
    ref_file = canvas_env / ".refs" / "r.png"
    _write_png(ref_file)
    assert canvas.safe_ref_path_allowlist(str(ref_file), [ref_root, canv_root]) == str(ref_file)
    assert canvas.safe_ref_path_allowlist(str(ref_file), [canv_root]) is None  # 白名单外拒绝
    assert canvas.safe_ref_path_allowlist(str(canvas_env / ".." / "escape.png"), [ref_root]) is None  # 穿越拒绝
    assert canvas.safe_ref_path_allowlist(str(canvas_env / "nope.png"), [ref_root]) is None  # 不存在也按路径校验


def test_workflow_save_strips_derived_image_paths(canvas_env):
    """工作流落盘时图片节点只存 registryId + 元数据，剥离派生路径 url/absPath（不修改入参）"""
    entry = _must(canvas.register_file(str(_write_png(canvas_env / "a.png", b"wf-strip")), "a.png"))
    node = {
        "id": f"img-{entry['id']}",
        "type": "image",
        "position": {"x": 1, "y": 2},
        "data": {
            "registryId": entry["id"],
            "name": "a.png",
            "url": "/api/image?path=OLD",
            "size": entry["size"],
            "ext": "png",
            "refCount": 1,
            "absPath": "C:\\old\\path.png",
        },
    }
    result = canvas.workflow_save("剥离", [node], [])
    assert result["ok"] is True
    stored = json.loads(Path(result["path"]).read_text(encoding="utf-8"))["nodes"][0]
    assert stored["data"]["registryId"] == entry["id"]
    assert stored["data"]["name"] == "a.png"
    assert stored["data"]["size"] == entry["size"]
    assert "url" not in stored["data"]
    assert "absPath" not in stored["data"]
    # 入参不被修改（归一化是副本）
    assert node["data"]["url"] == "/api/image?path=OLD"
    assert node["data"]["absPath"] == "C:\\old\\path.png"


def test_workflow_load_resolves_paths_from_registry(canvas_env):
    """旧格式存档（含过期绝对路径）加载时按 registryId 实时重建 url/absPath，自愈"""
    entry = _must(canvas.register_file(str(_write_png(canvas_env / "a.png", b"wf-resolve")), "a.png"))
    old_node = {
        "id": f"img-{entry['id']}",
        "type": "image",
        "position": {"x": 1, "y": 2},
        "data": {
            "registryId": entry["id"],
            "name": "a.png",
            "url": "/api/image?path=STALE",
            "size": entry["size"],
            "ext": "png",
            "refCount": 0,
            "absPath": "C:\\gone\\tools\\output\\.canvas\\x.png",
        },
    }
    wf_dir = canvas_env / "workflows"
    wf_dir.mkdir(parents=True, exist_ok=True)
    (wf_dir / "旧档.json").write_text(
        json.dumps({"version": 1, "name": "旧档", "nodes": [old_node], "edges": []}),
        encoding="utf-8",
    )
    result = canvas.workflow_load("旧档")
    assert result["ok"] is True
    assert result["missing"] == []
    data = result["nodes"][0]["data"]
    assert data["url"] != "/api/image?path=STALE"
    assert data["absPath"] != old_node["data"]["absPath"]
    assert data["absPath"] == str(canvas_env / ".canvas" / f"canv_{entry['id']}.png")
    assert os.path.isfile(data["absPath"])


def test_recovery_save_normalizes_image_nodes(canvas_env):
    """恢复快照与手动工作流同规则：图片节点不落派生路径"""
    entry = _must(canvas.register_file(str(_write_png(canvas_env / "a.png", b"rec-strip")), "a.png"))
    node = {
        "id": f"img-{entry['id']}",
        "type": "image",
        "position": {"x": 0, "y": 0},
        "data": {
            "registryId": entry["id"],
            "name": "a.png",
            "url": "/api/image?path=X",
            "size": entry["size"],
            "ext": "png",
            "refCount": 0,
            "absPath": "C:\\x.png",
        },
    }
    saved = canvas.recovery_save([node], [])
    stored = json.loads(Path(saved["path"]).read_text(encoding="utf-8"))["nodes"][0]["data"]
    assert stored["registryId"] == entry["id"]
    assert "url" not in stored
    assert "absPath" not in stored
    # 加载恢复快照时重新解析出正确路径
    latest = canvas.recovery_latest()
    data = latest["nodes"][0]["data"]
    assert data["absPath"] == str(canvas_env / ".canvas" / f"canv_{entry['id']}.png")
    assert data["url"].startswith("/api/image?path=")
    assert latest["missing"] == []


def test_recovery_snapshots_never_overwrite_named_workflow(canvas_env):
    """自动恢复每次创建新快照，手动命名存档内容保持不变。"""
    assert canvas.workflow_save("manual", [{"id": "manual"}], [])["ok"] is True
    manual = canvas_env / "workflows" / "manual.json"
    before = manual.read_bytes()

    first = canvas.recovery_save([{"id": "a"}], [])
    second = canvas.recovery_save([{"id": "b"}], [])

    assert first["path"] != second["path"]
    assert Path(first["path"]).is_file()
    assert Path(second["path"]).is_file()
    assert manual.read_bytes() == before


def test_recovery_snapshots_rotate_and_latest_skips_corrupt(canvas_env, monkeypatch):
    """恢复目录只保留上限数量，最新文件损坏时回退到最近可读快照。"""
    monkeypatch.setattr(canvas, "RECOVERY_LIMIT", 2, raising=False)
    first = canvas.recovery_save([{"id": "first"}], [])
    canvas.recovery_save([{"id": "second"}], [])
    latest = canvas.recovery_save([{"id": "third"}], [])

    snapshots = list((canvas_env / "workflows" / ".recovery").glob("recovery_*.json"))
    assert len(snapshots) == 2
    assert not Path(first["path"]).exists()

    Path(latest["path"]).write_text("{broken", encoding="utf-8")
    recovered = canvas.recovery_latest()
    assert recovered["nodes"] == [{"id": "second"}]
