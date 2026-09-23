#!/usr/bin/env python3
"""core/cost.py 单测：账本聚合统计 + 预算设置读写 + 超预算判定（纯逻辑，无网络无副作用）。"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import cost

TODAY = time.strftime("%Y-%m-%d")
YESTERDAY = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400))


def rec(status="ok", cost_value=0.05, seconds=10.0, size="1024x1024", mode="txt2img", day=None):
    return {
        "time": f"{day or TODAY} 10:00:00",
        "status": status,
        "cost": cost_value,
        "seconds": seconds,
        "size": size,
        "mode": mode,
        "prompt": "p",
    }


# ---------------- summarize_records ----------------

def test_summarize_counts_and_cost():
    records = [rec(), rec(cost_value=0.10, size="1152x2048"), rec(status="error", cost_value=0.0)]
    stats = cost.summarize_records(records)
    assert stats["total"] == 3
    assert stats["ok"] == 2
    assert stats["error"] == 1
    assert stats["successRate"] == 66.7
    assert stats["cost"] == 0.15
    assert stats["todayCost"] == 0.15


def test_summarize_failed_rows_never_count_cost():
    """失败行即便账本里带了 cost 也不计入（计费口径只看成功行）"""
    stats = cost.summarize_records([rec(status="error", cost_value=9.99)])
    assert stats["cost"] == 0.0
    assert stats["todayCost"] == 0.0


def test_summarize_avg_seconds_only_success():
    stats = cost.summarize_records([rec(seconds=100.0), rec(status="error", seconds=1.0), rec(seconds=200.0)])
    assert stats["avgSeconds"] == 150.0
    assert stats["seconds"] == 301.0


def test_summarize_by_day_size_mode():
    records = [
        rec(day=TODAY, size="1024x1024", mode="img2img", cost_value=0.05),
        rec(day=YESTERDAY, size="1152x2048", mode="txt2img", cost_value=0.10),
        rec(day=YESTERDAY, status="error", size="1152x2048", mode="txt2img"),
    ]
    stats = cost.summarize_records(records, days=5)
    days = {row["date"]: row for row in stats["byDay"]}
    assert days[TODAY]["count"] == 1 and days[TODAY]["ok"] == 1
    assert days[YESTERDAY]["count"] == 2 and days[YESTERDAY]["error"] == 1
    assert days[YESTERDAY]["cost"] == 0.10
    sizes = {row["size"]: row for row in stats["bySize"]}
    assert sizes["1152x2048"]["count"] == 2
    assert sizes["1024x1024"]["cost"] == 0.05
    modes = {row["mode"]: row for row in stats["byMode"]}
    assert modes["img2img"]["count"] == 1


def test_summarize_by_day_respects_days_window_and_order():
    records = [rec(day="2026-01-01"), rec(day="2026-01-02"), rec(day="2026-01-03")]
    stats = cost.summarize_records(records, days=2)
    assert [row["date"] for row in stats["byDay"]] == ["2026-01-03", "2026-01-02"]


def test_summarize_tolerates_bad_rows_and_types():
    """坏行 / 脏类型不抛异常（账本容错口径）：非 dict 直接忽略，脏字段按 0/未知处理"""
    records = [
        "not-a-dict",  # type: ignore[list-item]
        {"status": "ok", "cost": "3张", "seconds": None, "time": None, "size": None, "mode": None},
        {"status": "ok", "cost": 0.05, "time": "2026-01-01 00:00:00"},
    ]
    stats = cost.summarize_records(records)
    assert stats["total"] == 2  # 非 dict 行不计入
    assert stats["ok"] == 2
    assert stats["cost"] == 0.05
    assert any(row["date"] == "未知" for row in stats["byDay"])


def test_summarize_empty():
    stats = cost.summarize_records([])
    assert stats == {
        "total": 0, "ok": 0, "error": 0, "successRate": 0.0, "cost": 0.0,
        "seconds": 0.0, "avgSeconds": 0.0, "todayCost": 0.0,
        "byDay": [], "bySize": [], "byMode": [],
    }


def test_today_spent_only_success_and_today():
    records = [rec(), rec(day=YESTERDAY), rec(status="error")]
    assert cost.today_spent(records) == 0.05
    assert cost.today_spent(records, today=YESTERDAY) == 0.05


# ---------------- estimate_cost ----------------

def test_estimate_cost_known_size():
    """单价取 config.cost_for_size（1024x1024 = 0.05 元/张）"""
    assert cost.estimate_cost(3, "1024x1024") == 0.15


def test_estimate_cost_unknown_size_is_zero():
    assert cost.estimate_cost(5, "9999x9999") == 0.0


def test_estimate_cost_invalid_count():
    assert cost.estimate_cost(-3, "1024x1024") == 0.0
    assert cost.estimate_cost("abc", "1024x1024") == 0.0  # type: ignore[arg-type]


# ---------------- 预算设置读写 ----------------

def test_normalize_budget_defaults_and_cleaning():
    assert cost.normalize_budget(None) == {"dailyLimit": 0.0, "singleRunLimit": 0.0}
    assert cost.normalize_budget({"dailyLimit": -5, "singleRunLimit": "2.5"}) == {
        "dailyLimit": 0.0, "singleRunLimit": 2.5,
    }
    assert cost.normalize_budget({"unknown": 9}) == {"dailyLimit": 0.0, "singleRunLimit": 0.0}


def test_load_budget_missing_and_corrupt(cost_iso):
    assert cost.load_budget() == {"dailyLimit": 0.0, "singleRunLimit": 0.0}
    Path(cost.BUDGET_FILE).write_text("{ not json", encoding="utf-8")
    assert cost.load_budget() == {"dailyLimit": 0.0, "singleRunLimit": 0.0}


def test_save_load_budget_roundtrip(cost_iso):
    saved = cost.save_budget({"dailyLimit": 10, "singleRunLimit": 2})
    assert saved == {"dailyLimit": 10.0, "singleRunLimit": 2.0}
    assert cost.load_budget() == saved
    assert json.loads(Path(cost.BUDGET_FILE).read_text(encoding="utf-8")) == saved
    # 落盘后没有残留临时文件
    assert not list(Path(cost.BUDGET_FILE).parent.glob("*.tmp"))


# ---------------- check_budget ----------------

def test_check_budget_unlimited_always_allowed():
    result = cost.check_budget(999.0, {"dailyLimit": 0, "singleRunLimit": 0}, spent_today=0.0)
    assert result["allowed"] is True and result["over"] is False


def test_check_budget_single_limit_over_blocks_without_confirm():
    result = cost.check_budget(3.0, {"singleRunLimit": 2.0}, spent_today=0.0)
    assert result["over"] is True and result["allowed"] is False
    assert "单次上限" in result["reason"]
    assert cost.check_budget(3.0, {"singleRunLimit": 2.0}, spent_today=0.0, confirmed=True)["allowed"] is True


def test_check_budget_daily_limit_uses_spent_plus_estimate():
    result = cost.check_budget(3.0, {"dailyLimit": 10.0}, spent_today=8.0)
    assert result["over"] is True
    assert "今日已花 8.00" in result["reason"] and "当日预算 10.00" in result["reason"]
    assert result["remaining"] == 2.0
    # 未超限
    ok = cost.check_budget(1.0, {"dailyLimit": 10.0}, spent_today=8.0)
    assert ok["allowed"] is True and ok["remaining"] == 2.0


def test_check_budget_reports_both_limits():
    result = cost.check_budget(5.0, {"dailyLimit": 5.0, "singleRunLimit": 4.0}, spent_today=1.0)
    assert result["over"] is True
    assert "单次上限" in result["reason"] and "当日预算" in result["reason"]


def test_check_budget_zero_limit_no_remaining():
    result = cost.check_budget(1.0, {"dailyLimit": 0}, spent_today=99.0)
    assert result["allowed"] is True and result["remaining"] == 0.0


def test_check_budget_tolerates_bad_estimate_string():
    result = cost.check_budget("abc", {"dailyLimit": 1.0}, spent_today=0.0)  # type: ignore[arg-type]
    assert result["estimate"] == 0.0 and result["allowed"] is True


def test_check_budget_tolerates_none_estimate():
    result = cost.check_budget(None, {"dailyLimit": 1.0}, spent_today=0.0)  # type: ignore[arg-type]
    assert result["estimate"] == 0.0 and result["allowed"] is True
