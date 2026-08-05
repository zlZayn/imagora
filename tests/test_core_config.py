#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""core/config.py 单元测试

覆盖: get_api_key（环境变量 / 缺失报错）、RATIOS 表结构合法性。
"""
import re

import pytest

import core.config as config


def test_get_api_key_from_env(monkeypatch, tmp_path):
    """环境变量已设置 -> 直接返回"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.setenv(config.ENV_KEY_NAME, "sk-test")
    assert config.get_api_key() == "sk-test"


def test_get_api_key_missing_raises(monkeypatch, tmp_path):
    """未设置任何来源 -> 抛清晰错误"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.delenv(config.ENV_KEY_NAME, raising=False)
    with pytest.raises(RuntimeError, match="AIWANWU_API_KEY"):
        config.get_api_key()


def test_ratios_all_values_are_valid_size_format():
    """RATIOS 表里所有分辨率都是合法的 宽x高 格式"""
    size_pattern = re.compile(r"^\d+x\d+$")
    for ratio, tiers in config.RATIOS.items():
        assert re.fullmatch(r"^\d+:\d+$", ratio), f"比例格式非法: {ratio}"
        for tier, size in tiers.items():
            assert size_pattern.match(size), f"{ratio}/{tier} 分辨率非法: {size}"
            assert tier in {"1K", "2K", "4K"}, f"档位非法: {tier}"
