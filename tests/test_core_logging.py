#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""core/logging.py 单元测试

覆盖: log_generation 写入 JSONL、字段完整性、路径相对化。不依赖网络。
"""
import json

from core import logging as log_module


def test_log_generation_appends_line(monkeypatch, tmp_path):
    """每次调用追加一行 JSON，字段完整"""
    monkeypatch.setattr(log_module, "LOGS_DIR", tmp_path)
    log_module.log_generation(
        prompt="a test prompt",
        mode="txt2img",
        refs=0,
        size="1024x1024",
        quality="low",
        status="ok",
        output="",
        cost=0.05,
        seconds=3.2,
    )
    lines = (tmp_path / "generation.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["prompt"] == "a test prompt"
    assert record["mode"] == "txt2img"
    assert record["refs"] == 0
    assert record["cost"] == 0.05
    assert record["seconds"] == 3.2
    assert record["status"] == "ok"
    assert set(record) == {"time", "mode", "refs", "prompt", "size", "quality", "status", "cost", "seconds", "output"}


def test_log_generation_appends_multiple(monkeypatch, tmp_path):
    """多次调用累积多行"""
    monkeypatch.setattr(log_module, "LOGS_DIR", tmp_path)
    for i in range(3):
        log_module.log_generation(prompt=f"p{i}", mode="img2img", refs=1, size="1024x1024", quality="low", status="ok")
    assert len((tmp_path / "generation.jsonl").read_text(encoding="utf-8").splitlines()) == 3


def test_log_generation_path_relativized(monkeypatch, tmp_path):
    """工作根内的路径 -> 相对展示 + 正斜杠"""
    monkeypatch.setattr(log_module, "LOGS_DIR", tmp_path)
    from core.config import WORK_ROOT

    target = str(WORK_ROOT / "薄荷脑皮肤抑菌乳膏" / "output" / "a.png")
    log_module.log_generation(prompt="p", mode="img2img", refs=1, size="1024x1024", quality="low", status="ok", output=target)
    record = json.loads((tmp_path / "generation.jsonl").read_text(encoding="utf-8"))
    assert record["output"] == "薄荷脑皮肤抑菌乳膏/output/a.png"


def test_log_generation_failure_still_saves_prompt(monkeypatch, tmp_path):
    """生成失败（status=error）也要保存提示词"""
    monkeypatch.setattr(log_module, "LOGS_DIR", tmp_path)
    log_module.log_generation(
        prompt="失败也记录的提示词",
        mode="img2img",
        refs=2,
        size="1024x1024",
        quality="low",
        status="error",
        output="",
        cost=0.0,
        seconds=5.0,
    )
    record = json.loads((tmp_path / "generation.jsonl").read_text(encoding="utf-8"))
    assert record["status"] == "error"
    assert record["prompt"] == "失败也记录的提示词"


def test_log_generation_write_failure_does_not_raise(monkeypatch, tmp_path):
    """日志目录不可写时不抛异常（不影响主流程）"""
    monkeypatch.setattr(log_module, "LOGS_DIR", tmp_path / "readonly")
    # 目录创建失败（父路径是文件）会触发 OSError
    (tmp_path / "readonly").write_text("occupied", encoding="utf-8")
    # 不应抛异常
    log_module.log_generation(prompt="p", mode="txt2img", refs=0, size="1024x1024", quality="low", status="ok")
