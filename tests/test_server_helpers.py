#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""server.py 纯函数单元测试

覆盖: 尺寸费用查询、路径展示（相对工作根 + 正斜杠）、参考图服务端化（路径校验/上传/删除）。
不启动服务、不调 API。
"""
import os
from io import BytesIO

from fastapi import UploadFile
from starlette.datastructures import Headers

from core.config import WORK_ROOT

from server import display_path, size_cost


def test_size_cost_known_sizes():
    """已知尺寸 -> 对应费用"""
    assert size_cost("1024x1024") == 0.05
    assert size_cost("1152x2048") == 0.10


def test_size_cost_unknown_falls_back():
    """未知尺寸 -> 按 2K 档 0.10 兜底"""
    assert size_cost("9999x9999") == 0.10


def test_display_path_relative_to_work_root():
    """工作根内的路径 -> 相对展示 + 正斜杠"""
    assert display_path(str(WORK_ROOT / "薄荷脑皮肤抑菌乳膏" / "output" / "a.png")) == "薄荷脑皮肤抑菌乳膏/output/a.png"


def test_display_path_outside_work_root_uses_relative_up():
    """工作根外的同盘路径 -> 相对上跳展示 + 正斜杠（不保留原始绝对路径）"""
    result = display_path(r"D:\other\place\b.png")
    assert "\\" not in result
    assert result.startswith("../../")
    assert result.endswith("other/place/b.png")


def test_safe_ref_path_accepts_inside_ref_dir():
    """REF_DIR 内的路径 -> 放行（返回绝对路径）"""
    from server import REF_DIR, safe_ref_path

    p = os.path.join(REF_DIR, "ref_test.png")
    assert safe_ref_path(p) == os.path.abspath(p)


def test_safe_ref_path_rejects_outside():
    """REF_DIR 外的路径（含 ../ 穿越）-> 返回 None"""
    from server import safe_ref_path

    assert safe_ref_path(r"D:\outside\evil.png") is None
    assert safe_ref_path(os.path.join("..", "..", "evil.png")) is None


def test_upload_ref_returns_metadata_and_persists():
    """上传参考图 -> 返回 id/path/url/name/size/ext/mime，文件落盘 REF_DIR"""
    from server import REF_DIR, upload_ref

    upload = UploadFile(filename="a.png", file=BytesIO(b"fake-png-bytes"), headers=Headers({"content-type": "image/png"}))
    try:
        refs = upload_ref(images=[upload])["refs"]
        assert len(refs) == 1
        ref = refs[0]
        assert ref["name"] == "a.png"
        assert ref["size"] == len(b"fake-png-bytes")
        assert ref["ext"] == "png"
        assert ref["mime"] == "image/png"
        assert ref["path"].startswith(REF_DIR)
        assert os.path.isfile(ref["path"])
        assert ref["url"].startswith("/api/image?path=")
    finally:
        upload.file.close()
        ref_path = refs[0]["path"] if refs else None
        if ref_path and os.path.isfile(ref_path):
            os.unlink(ref_path)


def test_delete_ref_removes_file_and_tolerates_missing():
    """删除已落盘参考图 -> ok 且文件消失；文件不存在 / 非法路径也不抛错"""
    from server import REF_DIR, delete_ref, upload_ref

    upload = UploadFile(filename="b.jpg", file=BytesIO(b"jpeg-bytes"))
    try:
        dest = upload_ref(images=[upload])["refs"][0]["path"]
        assert os.path.isfile(dest)
        assert delete_ref(dest)["ok"] is True
        assert not os.path.isfile(dest)
        # 不存在也算成功
        assert delete_ref(os.path.join(REF_DIR, "ghost.png"))["ok"] is True
        # 非法路径不炸
        assert delete_ref(r"D:\outside.png")["ok"] is True
    finally:
        upload.file.close()


def test_get_config_window_id_increments():
    """连续无参调用 -> 窗口编号递增，默认输出目录按窗口分区"""
    from server import get_config

    first = get_config(None)
    second = get_config(None)
    assert second["windowId"] == first["windowId"] + 1
    assert first["defaultOutputDir"].endswith(f"win{first['windowId']}")
    assert second["defaultOutputDir"].endswith(f"win{second['windowId']}")


def test_get_config_keeps_existing_window_id():
    """传已有窗口号 -> 沿用该编号与对应分区（刷新页面编号不变）"""
    from server import get_config

    cfg = get_config(win=7)
    assert cfg["windowId"] == 7
    assert cfg["defaultOutputDir"].endswith("win7")


def test_get_config_ignores_invalid_window_id():
    """传 0 / 负数 -> 视为无效，重新分配新编号"""
    from server import get_config

    cfg = get_config(win=0)
    assert cfg["windowId"] >= 1


def test_next_window_increments_and_shares_counter():
    """连续调用 -> 编号递增；与 config 无参调用共用同一计数器（脚本开窗不撞号）"""
    from server import get_config, next_window

    a = next_window()["windowId"]
    b = next_window()["windowId"]
    assert b == a + 1
    c = get_config(None)["windowId"]
    assert c == b + 1


def test_generate_is_sync_not_coroutine():
    """generate 必须是同步函数：生成请求走 FastAPI 线程池，阻塞不卡事件循环
    （若为 async 且内部同步调 API，生成 1-2 分钟期间所有其他请求全部挂起，
     表现为：命令行按 N 开新窗口超时、页面右上角新窗口白屏）"""
    import inspect

    from server import generate

    assert not inspect.iscoroutinefunction(generate)
