#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""core/batch.py 单元测试

覆盖: 配置读取、底图路径解析、模块过滤、dry_run 预览（不调 API）。
"""
import json
from pathlib import Path

import pytest

from core.batch import filter_jobs_by_module, load_batch_config, resolve_base_image_paths, run_batch_generation


def make_jobs():
    return [
        {"id": "2a", "module": "2_product_info", "name": "a"},
        {"id": "3b", "module": "3_scope", "name": "b"},
        {"id": "5c", "module": "5_display", "name": "c"},
    ]


# ---------- filter_jobs_by_module ----------

def test_filter_no_filter_returns_all():
    """不过滤 -> 原列表"""
    jobs = make_jobs()
    assert filter_jobs_by_module(jobs, None) is jobs


def test_filter_by_modules():
    """按模块号过滤 -> 只保留对应模块"""
    jobs = make_jobs()
    result = filter_jobs_by_module(jobs, "2,5")
    assert [j["id"] for j in result] == ["2a", "5c"]


def test_filter_no_match_returns_empty():
    """模块号不匹配 -> 空列表"""
    assert filter_jobs_by_module(make_jobs(), "9") == []


# ---------- resolve_base_image_paths ----------

def test_resolve_relative_paths_join_config_dir(tmp_path):
    """相对路径 -> 拼接配置目录"""
    resolved = resolve_base_image_paths(tmp_path, {"a": "assets/x.png"})
    assert resolved["a"] == str(tmp_path / "assets" / "x.png")


def test_resolve_absolute_path_kept(tmp_path):
    """绝对路径 -> 原样保留"""
    resolved = resolve_base_image_paths(tmp_path, {"a": "C:/abs/y.png"})
    assert resolved["a"] == "C:/abs/y.png"


def test_resolve_empty_mapping():
    """空映射 -> 空结果"""
    assert resolve_base_image_paths(Path("."), None) == {}


# ---------- load_batch_config ----------

def test_load_batch_config(tmp_path):
    """读取 JSON 配置"""
    cfg_file = tmp_path / "batch_prompts.json"
    cfg_file.write_text(json.dumps({"size": "1024x1024", "jobs": []}), encoding="utf-8")
    config = load_batch_config(cfg_file)
    assert config["size"] == "1024x1024"


# ---------- run_batch_generation (dry_run, 不调 API) ----------

def test_run_batch_dry_run_returns_empty(tmp_path):
    """dry_run 只预览，返回空失败列表且不抛异常"""
    cfg_file = tmp_path / "batch_prompts.json"
    cfg_file.write_text(
        json.dumps({
            "out_dir": "output",
            "size": "1024x1024",
            "tier_cost": 0.05,
            "base_images": {},
            "jobs": [
                {"id": "1a", "module": "1_m", "name": "x", "image": None, "prompt": "p"},
            ],
        }),
        encoding="utf-8",
    )
    assert run_batch_generation(cfg_file, dry_run=True) == []


def test_run_batch_dry_run_with_module_filter(tmp_path):
    """dry_run + 模块过滤：不匹配模块时任务数为 0，返回空"""
    cfg_file = tmp_path / "batch_prompts.json"
    cfg_file.write_text(
        json.dumps({
            "out_dir": "output",
            "size": "1024x1024",
            "base_images": {},
            "jobs": [
                {"id": "1a", "module": "1_m", "name": "x", "image": None, "prompt": "p"},
                {"id": "2a", "module": "2_m", "name": "y", "image": None, "prompt": "p"},
            ],
        }),
        encoding="utf-8",
    )
    assert run_batch_generation(cfg_file, module_filter="9", dry_run=True) == []
