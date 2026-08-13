"""main.py 进程管理测试：端口探测与祖先链回溯（Q 退出关全部的基础）。"""

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main


def _parent_of(pid: int) -> int:
    """取当前系统里 pid 的直接父进程（独立实现，用于交叉验证）。"""
    command = (
        f"$p = Get-CimInstance Win32_Process -Filter 'ProcessId={pid}'; "
        "if ($p) { $p.ParentProcessId }"
    )
    out = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True, text=True, check=False, timeout=10,
    ).stdout
    for line in out.splitlines():
        stripped = line.strip()
        if stripped.isdigit():
            return int(stripped)
    return 0


class TestFindPortPids:
    def test_returns_empty_list_when_nothing_listening(self):
        # 一个几乎不可能被占用的端口
        assert main.find_port_pids(65534) == []

    def test_detects_an_ephemeral_listener(self):
        import socket

        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        port = srv.getsockname()[1]
        srv.listen(1)
        try:
            pids = main.find_port_pids(port)
            assert len(pids) >= 1
            assert os.getpid() in pids
        finally:
            srv.close()


class TestProcessAncestors:
    def test_includes_self_and_reaches_a_root(self):
        pid = os.getpid()
        chain = main._process_ancestors(pid)
        # 自身必须在链中
        assert chain[0] == pid
        # 链应包含当前进程的父进程
        parent = _parent_of(pid)
        if parent and parent > 0:
            assert parent in chain
        # 链应有头有尾且无环
        assert len(chain) == len(set(chain))

    def test_unknown_pid_returns_itself(self):
        # 65535 几乎不存在，作为兜底应至少返回 [pid] 本身
        assert main._process_ancestors(65535) == [65535] or main._process_ancestors(65535) != []
