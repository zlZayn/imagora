import json

from core import history


def _write_history(tmp_path, records):
    path = tmp_path / "generation.jsonl"
    lines = [json.dumps(record, ensure_ascii=False) if isinstance(record, dict) else record for record in records]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def test_read_history_skips_corrupt_lines_and_returns_newest_first(tmp_path, monkeypatch):
    path = _write_history(tmp_path, [
        {"time": "2026-08-09 10:00:00", "prompt": "first", "status": "ok", "output": "a.png"},
        "{broken",
        {"time": "2026-08-09 11:00:00", "prompt": "second", "status": "error", "output": ""},
    ])
    monkeypatch.setattr(history, "HISTORY_FILE", path)

    result = history.read_generation_history()

    assert [item["prompt"] for item in result] == ["second", "first"]


def test_read_history_filters_query_status_and_limit(tmp_path, monkeypatch):
    path = _write_history(tmp_path, [
        {"time": "1", "prompt": "red shoes", "quality": "high", "status": "ok"},
        {"time": "2", "prompt": "blue bag", "quality": "low", "status": "error"},
        {"time": "3", "prompt": "red bag", "quality": "high", "status": "ok"},
    ])
    monkeypatch.setattr(history, "HISTORY_FILE", path)

    result = history.read_generation_history(limit=1, query="RED", status="ok")

    assert len(result) == 1
    assert result[0]["prompt"] == "red bag"
def test_read_history_roundtrips_submission_fields(tmp_path, monkeypatch):
    """账本新字段（submissionId/inputAssetIds/outputAssetIds）随记录透传（读端容错缺字段）"""
    path = _write_history(tmp_path, [
        {"time": "1", "prompt": "p", "status": "ok",
         "submissionId": "sub-9", "inputAssetIds": ["a"], "outputAssetIds": ["b", "c"]},
        {"time": "0", "prompt": "old", "status": "ok"},  # 无新字段的旧行
    ])
    monkeypatch.setattr(history, "HISTORY_FILE", path)
    items = history.read_generation_history()
    first = next(i for i in items if i.get("submissionId"))
    assert first["submissionId"] == "sub-9"
    assert first["inputAssetIds"] == ["a"]
    assert first["outputAssetIds"] == ["b", "c"]
    old = next(i for i in items if i.get("prompt") == "old")
    assert "submissionId" not in old  # 旧行无字段，读端不炸

