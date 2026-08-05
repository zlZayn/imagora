#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""core/api.py 纯函数单元测试

覆盖: resolve_size_with_ratio、build_default_output_path。
纯函数测试，不调用网络 / 不消耗 API 额度。
"""
import re
from pathlib import Path

import pytest

from core.api import build_default_output_path, resolve_size_with_ratio


# ---------- resolve_size_with_ratio ----------

def test_resolve_size_default_when_nothing_given():
    """size 与 ratio 都为空 -> 默认 1024x1024"""
    assert resolve_size_with_ratio(None, None, "2K") == "1024x1024"


def test_resolve_size_returns_given_size():
    """只给 size -> 原样返回"""
    assert resolve_size_with_ratio("1536x1024", None, "2K") == "1536x1024"


def test_resolve_size_rejects_size_and_ratio_together():
    """size 与 ratio 同传 -> ValueError"""
    with pytest.raises(ValueError, match="不能同时使用"):
        resolve_size_with_ratio("1024x1024", "1:1", "2K")


def test_resolve_size_from_ratio():
    """ratio + 档位 -> 对应分辨率"""
    assert resolve_size_with_ratio(None, "9:16", "2K") == "1152x2048"
    assert resolve_size_with_ratio(None, "16:9", "4K") == "3840x2160"
    assert resolve_size_with_ratio(None, "1:1", "1K") == "1024x1024"


def test_resolve_size_rejects_unknown_ratio():
    """不支持的 ratio -> ValueError"""
    with pytest.raises(ValueError, match="不支持比例"):
        resolve_size_with_ratio(None, "5:4", "2K")


def test_resolve_size_rejects_unavailable_tier():
    """ratio 存在但该档位无此比例 -> ValueError"""
    with pytest.raises(ValueError, match="没有 1K 档"):
        resolve_size_with_ratio(None, "3:2", "1K")


# ---------- build_default_output_path ----------

def test_output_path_returns_given_path():
    """给了路径 -> 原样返回"""
    assert build_default_output_path("custom.png", "png") == "custom.png"


def test_output_path_generates_default_name():
    """未给路径 -> 生成 output/ai_时间戳.png"""
    result = build_default_output_path(None, "png")
    path = Path(result)
    assert path.parent.name == "output"
    assert re.fullmatch(r"ai_\d{8}_\d{6}\.png", path.name), f"文件名格式不符: {path.name}"


def test_output_path_respects_format():
    """默认文件后缀跟随格式参数"""
    result = build_default_output_path(None, "jpg")
    assert result.endswith(".jpg")
