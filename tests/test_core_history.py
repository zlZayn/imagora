import json
import os

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


def _write_hist(tmp_path, records):
    p = tmp_path / "generation.jsonl"
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n", encoding="utf-8")
    return p


def test_backfill_output_asset_ids_report_only_does_not_write(asset_iso, tmp_path, monkeypatch):
    """历史旧行补齐：默认只报告，不写文件。"""
    from core import registry
    src = asset_iso / "probe.png"
    src.write_bytes(b"asset-content")
    registry.register_asset(str(src), "probe.png")
    hist = _write_hist(tmp_path, [{"prompt": "p", "output": str(src)}])
    monkeypatch.setattr(history, "HISTORY_FILE", hist)
    before = hist.read_bytes()
    report = history.backfill_output_asset_ids()
    assert report["action"] == "report" and report["backfill"] == 1
    assert hist.read_bytes() == before


def test_backfill_output_asset_ids_apply_backs_up_and_idempotent(asset_iso, tmp_path, monkeypatch):
    """apply：补齐 + 备份 + 行数不变 + 幂等（二次跑 backfill=0）。"""
    from core import registry
    src = asset_iso / "probe.png"
    src.write_bytes(b"asset-content-2")
    entry = registry.register_asset(str(src), "probe.png")
    hist = _write_hist(tmp_path, [{"prompt": "p", "output": str(src)}])
    monkeypatch.setattr(history, "HISTORY_FILE", hist)
    report = history.backfill_output_asset_ids(apply=True)
    assert report["action"] == "backfilled" and report["backfill"] == 1
    assert report["backup"] and os.path.isfile(report["backup"])
    lines = hist.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    rec = json.loads(lines[0])
    assert rec["outputAssetIds"] == [entry["id"]]
    assert rec["prompt"] == "p"
    second = history.backfill_output_asset_ids(apply=True)
    assert second["backfill"] == 0 and second["already"] == 1


def test_backfill_output_asset_ids_skips_missing_file_and_unregistered(asset_iso, tmp_path, monkeypatch):
    """无法反查的行（文件缺失 / 注册表无该内容）跳过且计数，不被伪造。"""
    from core import registry
    src = asset_iso / "probe.png"
    src.write_bytes(b"content-missing")
    registry.register_asset(str(src), "probe.png")
    missing = tmp_path / "gone.png"
    missing.write_bytes(b"never-registered")
    hist = _write_hist(tmp_path, [
        {"prompt": "gone", "output": str(missing)},
        {"prompt": "deleted", "output": str(tmp_path / "nonexistent.png")},
    ])
    monkeypatch.setattr(history, "HISTORY_FILE", hist)
    report = history.backfill_output_asset_ids(apply=True)
    assert report["action"] == "backfilled" and report["backfill"] == 0
    assert report["unable"] == 2
    for line in hist.read_text(encoding="utf-8").splitlines():
        assert "outputAssetIds" not in json.loads(line)


def test_backfill_output_asset_ids_keeps_corrupt_lines(asset_iso, tmp_path, monkeypatch):
    """坏行原样保留、行数不变；好行照常补。"""
    from core import registry
    src = asset_iso / "probe.png"
    src.write_bytes(b"badline-content")
    registry.register_asset(str(src), "probe.png")
    hist = tmp_path / "generation.jsonl"
    hist.write_text("{broken\n" + json.dumps({"prompt": "ok", "output": str(src)}) + "\n", encoding="utf-8")
    monkeypatch.setattr(history, "HISTORY_FILE", hist)
    before_lines = len(hist.read_text(encoding="utf-8").splitlines())
    history.backfill_output_asset_ids(apply=True)
    after_lines = hist.read_text(encoding="utf-8").splitlines()
    assert len(after_lines) == before_lines
    assert after_lines[0] == "{broken"

