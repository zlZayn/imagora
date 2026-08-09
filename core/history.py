"""本地生成历史读取：容忍损坏 JSONL，支持轻量筛选。"""
import json
from pathlib import Path

from core.logging import LOGS_DIR

HISTORY_FILE = LOGS_DIR / "generation.jsonl"


def read_generation_history(
    limit: int = 200,
    query: str = "",
    status: str = "",
) -> list[dict]:
    """返回最新生成记录；坏行被忽略，单次最多 500 条。"""
    safe_limit = min(500, max(1, int(limit)))
    needle = query.strip().casefold()
    status_filter = status.strip().casefold()
    try:
        lines = Path(HISTORY_FILE).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    items: list[dict] = []
    for line in reversed(lines):
        try:
            record = json.loads(line)
        except (TypeError, ValueError):
            continue
        if not isinstance(record, dict):
            continue
        if status_filter and str(record.get("status", "")).casefold() != status_filter:
            continue
        if needle:
            haystack = " ".join(
                str(record.get(key, ""))
                for key in ("time", "prompt", "mode", "quality", "output")
            ).casefold()
            if needle not in haystack:
                continue
        items.append(record)
        if len(items) >= safe_limit:
            break
    return items
