#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""server.py 纯函数单元测试

覆盖: 尺寸费用查询、路径展示（相对工作根 + 正斜杠）。
不启动服务、不调 API。
"""
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
