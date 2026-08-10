#!/usr/bin/env python3
"""core/tasks.py 单元测试：全局任务池的并发上限、状态机、取消、快照与清理。"""
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.tasks import GenerationTask, TaskManager


def wait_terminal(manager, task_id, timeout=5):
    """轮询到终态（done/failed/cancelled），超时报错"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        snap = manager.snapshot(task_id)
        if snap and snap["status"] in ("done", "failed", "cancelled"):
            return snap
        time.sleep(0.01)
    raise AssertionError("task did not reach terminal state in time")


def wait_gone(path, timeout=2):
    """轮询等待文件被清理（终态快照返回后清理可能仍在进行）"""
    deadline = time.time() + timeout
    while path.exists() and time.time() < deadline:
        time.sleep(0.01)
    assert not path.exists(), f"file not cleaned: {path}"


@pytest.fixture
def manager():
    m = TaskManager(concurrency=2, max_tasks=20, terminal_ttl=0.05)
    yield m
    m._executor.shutdown(wait=True)


def test_submit_returns_id_snapshot(manager):
    """submit 返回 id，快照结构完整（run_task=None 时任务瞬时完成，状态只看合法集合）"""
    task = GenerationTask(prompt="x")
    tid = manager.submit(task)
    assert tid == task.id
    snap = manager.snapshot(tid)
    assert snap["taskId"] == tid
    assert snap["status"] in ("queued", "running", "done")
    assert snap["startedAt"] is not None


def test_done_snapshot_contains_results(manager):
    def run(t):
        t.results = [{"status": "ok", "message": t.id}]
        t.messages = ["ok"]
        t.total_cost = 1.5

    manager._run_task = run
    tid = manager.submit(GenerationTask(prompt="x"))
    snap = wait_terminal(manager, tid)
    assert snap["status"] == "done"
    assert snap["results"] == [{"status": "ok", "message": tid}]
    assert snap["messages"] == ["ok"]
    assert snap["totalCost"] == 1.5
    assert snap["startedAt"] is not None


def test_concurrency_capped(manager):
    """concurrency=2 时提交 5 个任务，同时 running 数不超过 2"""
    active = []
    max_active = 0
    lock = threading.Lock()

    def run(t):
        nonlocal max_active
        with lock:
            active.append(1)
            max_active = max(max_active, len(active))
        time.sleep(0.03)
        with lock:
            active.pop()
        t.results = [{"status": "ok", "message": t.id}]

    manager._run_task = run
    ids = [manager.submit(GenerationTask(prompt=str(i))) for i in range(5)]
    for tid in ids:
        wait_terminal(manager, tid)
    assert max_active <= 2


def test_cancel_queued_never_runs(manager):
    """排队中的任务取消后不执行"""
    entered = [threading.Event(), threading.Event()]
    release = threading.Event()
    ran = []

    def run(t):
        ran.append(t.id)
        entered[len(ran) - 1].set()
        release.wait(5)
        t.results = [{"status": "ok"}]

    manager._run_task = run
    tid1 = manager.submit(GenerationTask(prompt="a"))
    tid2 = manager.submit(GenerationTask(prompt="b"))
    assert entered[0].wait(1), "task1 未启动"
    assert entered[1].wait(1), "task2 未启动"
    tid3 = manager.submit(GenerationTask(prompt="c"))  # 并发槽已满，排队中
    assert manager.cancel(tid3) is True
    release.set()
    wait_terminal(manager, tid1)
    wait_terminal(manager, tid2)
    snap3 = manager.snapshot(tid3)
    assert snap3["status"] == "cancelled"
    assert "c" not in ran


def test_cancel_running_discards_result(manager):
    """running 中的任务取消后跑完但结果被丢弃（状态 cancelled）"""
    entered = threading.Event()
    release = threading.Event()

    def run(t):
        entered.set()
        release.wait(5)
        t.results = [{"status": "ok"}]

    manager._run_task = run
    tid = manager.submit(GenerationTask(prompt="x"))
    assert entered.wait(1), "run 未启动"
    assert manager.cancel(tid) is True
    release.set()
    snap = wait_terminal(manager, tid)
    assert snap["status"] == "cancelled"
    assert snap["cancelRequested"] is True


def test_cancel_terminal_returns_false(manager):
    def run(t):
        t.results = [{"status": "ok"}]

    manager._run_task = run
    tid = manager.submit(GenerationTask(prompt="x"))
    wait_terminal(manager, tid)
    assert manager.cancel(tid) is False


def test_failed_snapshot_error(manager):
    def run(t):
        t.error = "boom"

    manager._run_task = run
    tid = manager.submit(GenerationTask(prompt="x"))
    snap = wait_terminal(manager, tid)
    assert snap["status"] == "failed"
    assert snap["error"] == "boom"


def test_run_task_raise_falls_back_to_failed(manager):
    def run(t):
        raise RuntimeError("unexpected")

    manager._run_task = run
    tid = manager.submit(GenerationTask(prompt="x"))
    snap = wait_terminal(manager, tid)
    assert snap["status"] == "failed"
    assert "unexpected" in snap["error"]


def test_terminal_ttl_eviction(manager):
    """终态超 TTL 后快照返回 None（惰性清理）"""
    manager._run_task = lambda t: setattr(t, "results", [{"status": "ok"}])
    tid = manager.submit(GenerationTask(prompt="x"))
    wait_terminal(manager, tid)
    time.sleep(0.1)  # 超过 terminal_ttl=0.05
    assert manager.snapshot(tid) is None


def test_temp_bases_cleaned_on_finish(manager, tmp_path):
    """临时兜底文件在任务终结后统一清理"""
    f = tmp_path / "tmp.png"
    f.write_bytes(b"x")
    manager._run_task = lambda t: setattr(t, "results", [{"status": "ok"}])
    tid = manager.submit(GenerationTask(prompt="x", temp_bases=[str(f)]))
    wait_terminal(manager, tid)
    wait_gone(f)


def test_cancelled_queued_cleans_temp(manager, tmp_path):
    """排队中取消的任务也清理临时文件"""
    entered = threading.Event()
    release = threading.Event()
    ran = []

    def run(t):
        ran.append(t.id)
        entered.set()
        release.wait(5)

    manager._run_task = run
    tid1 = manager.submit(GenerationTask(prompt="a"))
    assert entered.wait(1)
    f = tmp_path / "tmp2.png"
    f.write_bytes(b"x")
    tid2 = manager.submit(GenerationTask(prompt="b", temp_bases=[str(f)]))  # 排队
    assert manager.cancel(tid2) is True
    release.set()
    wait_terminal(manager, tid1)
    wait_gone(f)
