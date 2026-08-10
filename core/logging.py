#!/usr/bin/env python3
"""生成日志 —— 每次生图记录到 logs/generation.jsonl（个人日志，git 忽略）

统一由 server（界面）、batch（批量）、main（CLI）调用，避免日志逻辑散落。
每条记录一行 JSON，字段精简：时间 / 模式 / 参考图数 / 提示词 / 尺寸 / 质量 / 结果 / 费用 / 耗时 / 输出路径。
"""
import json
import threading
import time
from pathlib import Path

from core.config import WORK_ROOT

BASE_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = BASE_DIR / "logs"

# 多窗口 / 多请求并发写同一 JSONL：串行追加，杜绝记录交错
_LOCK = threading.Lock()


def _display_path(path: str) -> str:
    """相对工作根展示路径（空则不显示），统一正斜杠"""
    if not path:
        return ""
    try:
        return str(Path(path).resolve().relative_to(WORK_ROOT)).replace("\\", "/")
    except ValueError:
        return path.replace("\\", "/")


def log_generation(prompt: str, mode: str, refs: int, size: str, quality: str,
                   status: str, output: str = "", cost: float = 0.0,
                   seconds: float = 0.0, win: int | None = None) -> None:
    """记录一次生成结果。

    Args:
        prompt: 提示词
        mode: img2img（图生图）或 txt2img（文生图）
        refs: 参考图张数
        size / quality: 尺寸与质量
        status: ok 或 error
        output: 输出路径（相对工作根展示）
        cost: 本次费用（元）
        seconds: 耗时（秒）
        win: 窗口编号（多开页面时传，None 则不记录）
    """
    record = {
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "mode": mode,
        "refs": refs,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "status": status,
        "cost": round(cost, 2),
        "seconds": round(seconds, 1),
        "output": _display_path(output),
    }
    if win is not None:
        record["win"] = win
    # 日志失败不影响主流程：写入出错静默跳过
    try:
        with _LOCK:
            LOGS_DIR.mkdir(exist_ok=True)
            with open(LOGS_DIR / "generation.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass
