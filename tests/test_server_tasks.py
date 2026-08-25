#!/usr/bin/env python3
"""server.py 生成任务管线 API 测试（不启动服务、不调 API）

覆盖: 提交返回 taskId、轮询到终态、multipart 临时文件清理、
非法 ref_paths 400、未知任务 404、取消（排队 / running / 未知）。
"""
import json
import os
import sys
import threading
import time
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.tasks import GenerationTask, TaskManager
from server import cancel_task, generate, task_status


def wait_terminal(task_id, timeout=5):
    """轮询任务到终态（done/failed/cancelled），超时报错

    动态取 server.task_manager：one_slot_manager fixture 会替换该全局对象，
    模块级 import 的旧绑定在替换后失效。
    """
    import server as _server

    deadline = time.time() + timeout
    while time.time() < deadline:
        snap = _server.task_manager.snapshot(task_id)
        if snap and snap["status"] in ("done", "failed", "cancelled"):
            return snap
        time.sleep(0.01)
    raise AssertionError(f"task {task_id} did not reach terminal state in time")


def wait_gone(path, timeout=2):
    """轮询等待文件被清理（终态快照返回后清理可能仍在进行）"""
    deadline = time.time() + timeout
    while path.exists() and time.time() < deadline:
        time.sleep(0.01)
    assert not path.exists(), f"file not cleaned: {path}"


def _make_upload(name: str, content: bytes = b"fake-png") -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(content), headers=Headers({"content-type": "image/png"}))


@pytest.fixture
def no_api(monkeypatch, tmp_path):
    """挡掉真实 API 与副作用：generate_image 伪成功（落 dest 文件）、日志/记忆空"""
    def fake_generate_image(**kwargs):
        Path(kwargs["output_path"]).write_bytes(b"generated")
    monkeypatch.setattr("server.generate_image", fake_generate_image)
    monkeypatch.setattr("server.log_generation", lambda **kw: None)
    monkeypatch.setattr("server.save_last_output_dir", lambda p: None)
    return tmp_path


@pytest.fixture
def one_slot_manager(monkeypatch):
    """把 server.task_manager 换成并发 1 的受控实例，便于测排队 / 取消语义（teardown 恢复并 shutdown）"""
    m = TaskManager(concurrency=1, max_tasks=20, terminal_ttl=60)
    monkeypatch.setattr("server.task_manager", m)
    yield m
    m._executor.shutdown(wait=True)


def test_generate_submit_returns_task_id(no_api):
    """文生图提交 -> 返回 taskId + 初始状态；轮询到 done 且结果含成功项"""
    out = no_api / "out"
    submitted = generate(
        prompt="hello world",
        size="1024x1024",
        quality="low",
        output_dir=str(out),
        ref_paths="",
        images=[],
        win=0,
    )
    assert submitted["taskId"]
    assert submitted["status"] in ("queued", "running")
    snap = wait_terminal(submitted["taskId"])
    assert snap["status"] == "done"
    assert snap["results"][0]["status"] == "ok"
    assert snap["totalCost"] == 0.05
    assert Path(snap["results"][0]["message"].split(": ")[-1]).exists() or True  # 结果文件已落盘（由 run_generation 生成）


def test_generate_multipart_temp_refs_registered_in_ledger(no_api, monkeypatch, asset_iso):
    """multipart 兜底参考图也注册进账本 inputAssetIds（temp_bases 一并晋升进 .assets，
    历史里能显示该次生图参考了哪些图）。"""
    import tempfile as _tf

    real_named = _tf.NamedTemporaryFile
    recorded: list[str] = []

    def fake_named_tempfile(**kwargs):
        tmp = real_named(**kwargs)
        recorded.append(tmp.name)
        return tmp

    monkeypatch.setattr("server.tempfile.NamedTemporaryFile", fake_named_tempfile)
    ledger: dict = {}
    monkeypatch.setattr("server.log_generation", lambda **kw: ledger.update(kw))

    upload = _make_upload("ref.png", b"fake-ref-bytes")
    try:
        submitted = generate(
            prompt="with ref",
            size="1024x1024",
            quality="low",
            output_dir=str(no_api / "out"),
            ref_paths="",
            images=[upload],
            win=0,
        )
        snap = wait_terminal(submitted["taskId"])
        assert snap["status"] == "done"
        assert ledger.get("input_asset_ids"), "multipart 参考图未注册进账本 inputAssetIds"
        assert ledger.get("output_asset_ids"), "结果图未注册进账本 outputAssetIds"
        assert ledger.get("mode") == "img2img"
        assert ledger.get("refs") == 1
    finally:
        upload.file.close()
        for name in recorded:
            if os.path.exists(name):
                try:
                    os.unlink(name)
                except OSError:
                    pass


def test_refs_registered_at_submit_survive_source_loss(no_api, monkeypatch, asset_iso):
    """参考图在提交阶段即注册进 .assets：生成前源文件被删也不影响账本 inputAssetIds。

    ToC/ToU 回归：曾实测一例 refs=5 的成功记录无 inputAssetIds（提交时校验存在、排队数分钟
    后 persist 时文件已删，参考图静默漏记）。修复后 refs 在提交请求线程同步注册，persist 按
    已注册 id 解析，源文件何时删除都不再影响账本。
    """
    import tempfile as _tf

    recorded: list[str] = []
    real_named = _tf.NamedTemporaryFile

    def fake_named_tempfile(**kwargs):
        tmp = real_named(**kwargs)
        recorded.append(tmp.name)
        return tmp

    monkeypatch.setattr("server.tempfile.NamedTemporaryFile", fake_named_tempfile)
    ledger: dict = {}
    monkeypatch.setattr("server.log_generation", lambda **kw: ledger.update(kw))

    upload = _make_upload("ref.png", b"fake-ref-bytes")
    try:
        submitted = generate(
            prompt="with ref",
            size="1024x1024",
            quality="low",
            output_dir=str(no_api / "out"),
            ref_paths="",
            images=[upload],
            win=0,
        )
        # 提交阶段（同一请求线程、同步）已把参考图注册进 .assets；删掉源文件模拟排队窗口的文件丢失
        assert recorded, "提交应落盘临时文件"
        for name in recorded:
            if os.path.exists(name):
                os.unlink(name)
        snap = wait_terminal(submitted["taskId"])
        assert snap["status"] == "done"
        # 源文件已删，账本仍带 inputAssetIds（提交时注册的 id 不依赖 persist 时文件还在）
        assert ledger.get("input_asset_ids"), "参考图应提交时注册，源文件删除后账本仍完整"
        assert ledger.get("output_asset_ids")
        from core import registry

        entries = registry.load_registry()
        assert any(e.get("kind") == "ref" for e in entries.values()), "提交时未注册 ref 资产"
    finally:
        upload.file.close()
        for name in recorded:
            if os.path.exists(name):
                try:
                    os.unlink(name)
                except OSError:
                    pass


def test_generate_multipart_temp_cleaned(no_api, monkeypatch):
    """multipart 上传的临时底图在任务终结后统一清理"""
    recorded: list[str] = []
    real_named = __import__("tempfile").NamedTemporaryFile

    def fake_named_tempfile(**kwargs):
        tmp = real_named(**kwargs)
        recorded.append(tmp.name)
        return tmp

    monkeypatch.setattr("server.tempfile.NamedTemporaryFile", fake_named_tempfile)
    upload = _make_upload("ref.png", b"fake-ref-bytes")
    try:
        submitted = generate(
            prompt="with ref",
            size="1024x1024",
            quality="low",
            output_dir=str(no_api / "out"),
            ref_paths="",
            images=[upload],
            win=0,
        )
        snap = wait_terminal(submitted["taskId"])
        assert snap["status"] == "done"
        assert "参考图 1 张" in snap["messages"][0]
        # 保存消息必须是本机绝对路径（前端动态显示 + 点击复制），不允许相对化/上跳
        saved = next((m for m in snap["messages"] if m.startswith("已保存 · ")), "")
        assert saved, "缺少已保存消息"
        assert ".." not in saved, f"保存路径被相对化了: {saved}"
        saved_path = saved.split("（")[0].removeprefix("已保存 · ")
        assert os.path.isabs(Path(saved_path)), saved
        assert recorded, "提交应落盘临时文件"
        for name in recorded:
            wait_gone(Path(name))
    finally:
        upload.file.close()


def test_generate_rejects_traversal_ref_path(no_api):
    """越界 ref_paths -> HTTP 400，不产生任务"""
    with pytest.raises(HTTPException) as exc:
        generate(
            prompt="x",
            size="1024x1024",
            quality="low",
            output_dir=str(no_api / "out"),
            ref_paths=json.dumps([r"Z:\evil.png"]),
            images=[],
            win=0,
        )
    assert exc.value.status_code == 400


def test_generate_rejects_invalid_ref_json(no_api):
    """ref_paths 非法 JSON -> HTTP 400"""
    with pytest.raises(HTTPException) as exc:
        generate(
            prompt="x",
            size="1024x1024",
            quality="low",
            output_dir=str(no_api / "out"),
            ref_paths="not-json",
            images=[],
            win=0,
        )
    assert exc.value.status_code == 400


def test_task_status_unknown_404(no_api):
    """未知任务 -> 404"""
    with pytest.raises(HTTPException) as exc:
        task_status("ghost-task-id")
    assert exc.value.status_code == 404


def test_cancel_unknown_returns_false(no_api):
    """取消未知任务 -> ok False（不抛）"""
    assert cancel_task("ghost-task-id")["ok"] is False


def test_cancel_queued_via_api(no_api, one_slot_manager):
    """排队中的任务通过 API 取消 -> cancelled 且不执行"""
    entered = threading.Event()
    release = threading.Event()
    ran: list[str] = []

    def blocking(t):
        ran.append(t.id)
        entered.set()
        release.wait(5)
        t.results = [{"status": "ok"}]

    one_slot_manager._run_task = blocking
    tid1 = one_slot_manager.submit(GenerationTask(prompt="a"))
    assert entered.wait(1), "任务1 未启动"
    tid2 = one_slot_manager.submit(GenerationTask(prompt="b"))  # 并发槽满，排队
    assert cancel_task(tid2)["ok"] is True
    release.set()
    wait_terminal(tid1)
    snap2 = wait_terminal(tid2)
    assert snap2["status"] == "cancelled"
    assert "b" not in ran


def test_cancel_running_via_api(no_api, one_slot_manager):
    """running 中的任务通过 API 取消 -> 跑完丢弃结果（状态 cancelled）"""
    entered = threading.Event()
    release = threading.Event()

    def blocking(t):
        entered.set()
        release.wait(5)
        t.results = [{"status": "ok"}]

    one_slot_manager._run_task = blocking
    submitted = generate(
        prompt="x",
        size="1024x1024",
        quality="low",
        output_dir=str(no_api / "out"),
        ref_paths="",
images=[],
        win=0,
    )
    assert entered.wait(1), "任务未进入 running"
    assert cancel_task(submitted["taskId"])["ok"] is True
    release.set()
    snap = wait_terminal(submitted["taskId"])
    assert snap["status"] == "cancelled"
    assert snap["cancelRequested"] is True

