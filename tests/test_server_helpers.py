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
