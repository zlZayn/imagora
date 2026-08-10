#!/usr/bin/env python3
"""server.py canvas 路由单元测试（不启动服务、不调 API）

覆盖: 画布上传/导入/列表/删除、工作流保存/加载（往返/缺失/版本）、
/api/generate 的 ref_paths 放行 canvas 目录。
"""
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (
    canvas_image_delete,
    canvas_images,
    canvas_import,
    canvas_upload,
    canvas_workflow_list,
    canvas_workflow_load,
    canvas_workflow_save,
)


@pytest.fixture
def canvas_env(tmp_path, monkeypatch):
    """把 core.canvas 的目录常量注入 tmp_path，避免污染真实 output/.canvas 与 output/workflows"""
    from core import canvas

    monkeypatch.setattr(canvas, "DEFAULT_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(canvas, "CANVAS_DIR", str(tmp_path / ".canvas"))
    monkeypatch.setattr(canvas, "REGISTRY_FILE", str(tmp_path / ".canvas" / "registry.json"))
    monkeypatch.setattr(canvas, "WORKFLOWS_DIR", str(tmp_path / "workflows"))
    monkeypatch.setattr(canvas, "RECOVERY_DIR", str(tmp_path / "workflows" / ".recovery"), raising=False)
    return tmp_path


def _make_upload(name: str, content: bytes = b"fake-canvas-png") -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(content), headers=Headers({"content-type": "image/png"}))


def test_canvas_upload_registers(canvas_env):
    upload = _make_upload("a.png")
    try:
        result = canvas_upload(images=[upload])
        assert len(result["images"]) == 1
        img = result["images"][0]
        assert img["name"] == "a.png"
        assert img["ext"] == "png"
        assert img["relPath"].startswith(".canvas/canv_")
        assert os.path.isfile(img["absPath"])
    finally:
        upload.file.close()


def test_canvas_import_directory(canvas_env):
    (canvas_env / "win1").mkdir(parents=True)
    (canvas_env / "win1" / "x.png").write_bytes(b"png-x")
    result = canvas_import({"paths": [str(canvas_env / "win1")]})
    assert len(result["imported"]) == 1
    assert result["skipped"] == []


def test_canvas_import_single_file(canvas_env):
    src = canvas_env / "single.png"
    src.write_bytes(b"png-single")
    result = canvas_import({"paths": [str(src)]})
    assert len(result["imported"]) == 1
    assert result["imported"][0]["name"] == "single.png"


def test_canvas_import_outside_skipped(canvas_env, tmp_path_factory):
    outside = tmp_path_factory.mktemp("out")
    evil = outside / "evil.png"
    evil.write_bytes(b"evil")
    result = canvas_import({"paths": [str(evil)]})
    assert result["imported"] == []
    assert len(result["skipped"]) == 1


def test_canvas_images_list(canvas_env):
    canvas_upload(images=[_make_upload("a.png")])["images"][0]
    result = canvas_images()
    assert len(result["images"]) == 1
    assert result["images"][0]["absPath"]


def test_canvas_image_delete(canvas_env):
    img = canvas_upload(images=[_make_upload("a.png")])["images"][0]
    assert canvas_image_delete({"id": img["id"]})["ok"] is True
    assert canvas_images()["images"] == []
    # 不存在的 id 也返回 ok:False（不抛）
    assert canvas_image_delete({"id": "ghost"})["ok"] is False


def test_workflow_save_writes_versioned_file(canvas_env):
    nodes = [{"id": "n1", "type": "prompt", "position": {"x": 0, "y": 0}, "data": {"prompt": "hi", "size": "1024x1024", "quality": "low", "outputDir": str(canvas_env), "status": "idle"}}]
    edges = []
    result = canvas_workflow_save({"name": "测试工作流", "nodes": nodes, "edges": edges})
    assert result["ok"] is True
    assert result["path"].endswith(f"workflows{os.sep}测试工作流.json")
    data = json.loads(Path(result["path"]).read_text(encoding="utf-8"))
    assert data["version"] == 1
    assert data["name"] == "测试工作流"
    assert data["nodes"] == nodes


def test_workflow_save_sanitizes_dangerous_name(canvas_env):
    """名字含路径分隔符/穿越 -> 清洗后写固定目录（不越权写外部路径）"""
    result = canvas_workflow_save({"name": "../../evil", "nodes": [], "edges": []})
    assert result["ok"] is True
    # 路径分隔符被清洗，文件仍落在 WORKFLOWS_DIR 内（无穿越）
    assert os.path.dirname(result["path"]) == str(canvas_env / "workflows")
    assert os.path.basename(result["path"]).endswith(".json")


def test_workflow_save_empty_name_returns_error(canvas_env):
    with pytest.raises(Exception):
        canvas_workflow_save({"name": "  ", "nodes": [], "edges": []})


def test_workflow_save_unserializable_returns_error(canvas_env):
    nodes = [{"id": "n", "type": "prompt", "data": {"blob": b"not-json"}}]
    with pytest.raises(Exception):
        canvas_workflow_save({"name": "bad", "nodes": nodes, "edges": []})


def test_workflow_list_returns_saved(canvas_env):
    canvas_workflow_save({"name": "w1", "nodes": [], "edges": []})
    canvas_workflow_save({"name": "w2", "nodes": [], "edges": []})
    result = canvas_workflow_list()
    names = {w["name"] for w in result["workflows"]}
    assert names == {"w1", "w2"}


def test_workflow_load_roundtrip(canvas_env):
    nodes = [{"id": "p1", "type": "prompt", "position": {"x": 1, "y": 2}, "data": {"prompt": "hi", "status": "idle"}}]
    edges = [{"id": "e1", "source": "img1", "target": "p1"}]
    canvas_workflow_save({"name": "往返", "nodes": nodes, "edges": edges})
    result = canvas_workflow_load("往返")
    assert result["name"] == "往返"
    assert result["nodes"] == nodes
    assert result["edges"] == edges
    assert result["missing"] == []


def test_workflow_load_missing_image(canvas_env):
    nodes = [{"id": "img1", "type": "image", "position": {"x": 0, "y": 0}, "data": {"registryId": "nope123", "name": "丢失图"}}]
    canvas_workflow_save({"name": "缺图", "nodes": nodes, "edges": []})
    result = canvas_workflow_load("缺图")
    assert result["missing"] == ["nope123"]
    assert result["nodes"] == nodes


def test_workflow_load_wrong_version(canvas_env):
    path = canvas_env / "workflows" / "v2.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 2, "nodes": [], "edges": []}), encoding="utf-8")
    with pytest.raises(Exception):
        canvas_workflow_load("v2")


def test_workflow_load_missing_file(canvas_env):
    with pytest.raises(Exception):
        canvas_workflow_load("ghost")


def test_canvas_recovery_routes_roundtrip(canvas_env):
    """恢复路由保存新快照，并能读取最近一份。"""
    from server import canvas_recovery_latest, canvas_recovery_save

    nodes = [{"id": "p1", "type": "prompt"}]
    saved = canvas_recovery_save({"nodes": nodes, "edges": []})
    latest = canvas_recovery_latest()

    assert saved["ok"] is True
    assert latest["nodes"] == nodes
    assert latest["edges"] == []


def test_generate_ref_paths_accepts_canvas_dir(canvas_env, monkeypatch):
    """/api/generate 的 ref_paths 放行 canvas 目录内路径（画布参考图可复用）"""
    from server import generate

    # 登记一个真实画布文件
    img = canvas_upload(images=[_make_upload("ref.png", b"canvas-ref-content")])["images"][0]
    # 挡掉真实 API 与日志：generate_image 伪成功（创建 dest 文件）、log_generation 空
    # 注意：server 导入时已绑定名字，必须 monkeypatch server 命名空间
    def fake_generate_image(**kwargs):
        Path(kwargs["output_path"]).write_bytes(b"generated")
    monkeypatch.setattr("server.generate_image", fake_generate_image)
    monkeypatch.setattr("server.log_generation", lambda **kw: None)
    # 防止测试副作用污染真实 output/.last_output_dir（generate 成功后默认会写入）
    monkeypatch.setattr("server.save_last_output_dir", lambda p: None)

    result = generate(
        prompt="测试",
        size="1024x1024",
        quality="low",
        output_dir=str(canvas_env / "out"),
        ref_paths=json.dumps([img["absPath"]]),
        images=[],  # 直接调用时 File(default=[]) 的默认值是 File 对象，必须显式传空列表
        win=1,
    )
    assert result["results"][0]["status"] == "ok"
    assert "参考图 1 张" in result["messages"][0]
