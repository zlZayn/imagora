#!/usr/bin/env python3
"""成本统计与预算保护 —— 账本聚合 + 预算估算/校验。

职责边界（薄且纯）：
- 统计：把 logs/generation.jsonl 的原始记录聚合成本看板所需的指标（总量/成功率/费用/耗时/按天/按尺寸/按模式）；
- 预算：本机预算设置（`output/.budget.json`，git 忽略）的读写 + 单次/当日超限判定。

设计取舍：
- 统计一律基于**原始行**（不去重）：每个成功行都真实花过钱，聚合去重会少算费用；
- 预算语义是「超限需确认」而非硬拦：`check_budget(confirmed=True)` 永远放行，
  由调用方（前端）负责弹确认，避免误配预算把正常工作拦死；
- `0`（或缺失）表示不限，默认不打扰用户；
- 费用来源唯一：`core.config.cost_for_size`（config.json 的 size_options），不在此硬编码价格。
"""
import json
import os
import time

from core.config import DEFAULT_OUTPUT_DIR, cost_for_size

# 本机预算设置（放输出目录：随 output/ 一起被 git 忽略，不进公开仓库）
BUDGET_FILE = os.path.join(DEFAULT_OUTPUT_DIR, ".budget.json")

# 0 = 不限；单次 = 一次提交/一次批量重跑的总预估，当日 = 当天累计已花 + 本次预估
DEFAULT_BUDGET = {"dailyLimit": 0.0, "singleRunLimit": 0.0}

# 看板默认回看天数（按天分布）
DEFAULT_DAYS = 14


def _to_float(value: object, default: float = 0.0) -> float:
    """容错转 float：坏行/脏字段不抛异常（账本容错口径与 core/history 一致）"""
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _to_int(value: object, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _day_of(record: dict) -> str:
    """记录日期（账本 time 形如 2026-08-25 10:45:19）；缺失/异常返回空串"""
    return str(record.get("time") or "")[:10]


def summarize_records(records: list[dict], days: int = DEFAULT_DAYS) -> dict:
    """把账本原始记录聚合为成本看板指标（纯函数，容忍坏行）。

    返回：
      total / ok / error / successRate(%) / cost / seconds / avgSeconds（仅成功行平均）
      todayCost（今天已花）
      byDay  [{date, count, ok, error, cost}]   最近 days 天（有记录的日期，倒序）
      bySize [{size, count, cost}]              倒序
      byMode [{mode, count, cost}]              倒序
    """
    safe_days = max(1, _to_int(days, DEFAULT_DAYS))
    today = time.strftime("%Y-%m-%d")
    total = ok = error = 0
    cost = 0.0
    seconds = 0.0
    ok_seconds = 0.0
    today_cost = 0.0
    per_day: dict[str, dict] = {}
    per_size: dict[str, dict] = {}
    per_mode: dict[str, dict] = {}

    for record in records:
        if not isinstance(record, dict):
            continue
        total += 1
        success = str(record.get("status") or "") == "ok"
        row_cost = _to_float(record.get("cost")) if success else 0.0
        row_seconds = _to_float(record.get("seconds"))
        if success:
            ok += 1
            cost += row_cost
            ok_seconds += row_seconds
            day = _day_of(record)
            if day == today:
                today_cost += row_cost
        else:
            error += 1
        seconds += row_seconds

        day = _day_of(record) or "未知"
        day_row = per_day.setdefault(day, {"date": day, "count": 0, "ok": 0, "error": 0, "cost": 0.0})
        day_row["count"] += 1
        day_row["ok" if success else "error"] += 1
        if success:
            day_row["cost"] = round(day_row["cost"] + row_cost, 2)

        size = str(record.get("size") or "-")
        size_row = per_size.setdefault(size, {"size": size, "count": 0, "cost": 0.0})
        size_row["count"] += 1
        if success:
            size_row["cost"] = round(size_row["cost"] + row_cost, 2)

        mode = str(record.get("mode") or "-")
        mode_row = per_mode.setdefault(mode, {"mode": mode, "count": 0, "cost": 0.0})
        mode_row["count"] += 1
        if success:
            mode_row["cost"] = round(mode_row["cost"] + row_cost, 2)

    by_day = sorted(per_day.values(), key=lambda r: str(r["date"]), reverse=True)[:safe_days]
    return {
        "total": total,
        "ok": ok,
        "error": error,
        "successRate": round(ok * 100.0 / total, 1) if total else 0.0,
        "cost": round(cost, 2),
        "seconds": round(seconds, 1),
        "avgSeconds": round(ok_seconds / ok, 1) if ok else 0.0,
        "todayCost": round(today_cost, 2),
        "byDay": by_day,
        "bySize": sorted(per_size.values(), key=lambda r: (-r["count"], r["size"]))[:10],
        "byMode": sorted(per_mode.values(), key=lambda r: (-r["count"], r["mode"]))[:10],
    }


def today_spent(records: list[dict], today: str | None = None) -> float:
    """当天已花费用（仅成功行计入；纯函数）"""
    day = today or time.strftime("%Y-%m-%d")
    spent = 0.0
    for record in records:
        if not isinstance(record, dict):
            continue
        if str(record.get("status") or "") != "ok":
            continue
        if _day_of(record) == day:
            spent += _to_float(record.get("cost"))
    return round(spent, 2)


def estimate_cost(count: int, size: str) -> float:
    """一次批量提交的预估费用（张数 × 该尺寸单价；未知尺寸单价 0，由调用方提示）"""
    safe_count = max(0, _to_int(count))
    return round(cost_for_size(size) * safe_count, 2)


def normalize_budget(settings: dict | None) -> dict:
    """补齐/清洗预算设置（负数为 0，缺失取默认；纯函数）"""
    raw = settings if isinstance(settings, dict) else {}
    out = {}
    for key, default in DEFAULT_BUDGET.items():
        value = _to_float(raw.get(key), default)
        out[key] = round(value, 2) if value > 0 else 0.0
    return out


def load_budget(path: str | None = None) -> dict:
    """读取本机预算设置；文件缺失/损坏回退默认（不抛异常）"""
    target = path or BUDGET_FILE
    try:
        with open(target, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return dict(DEFAULT_BUDGET)
    return normalize_budget(data)


def save_budget(settings: dict, path: str | None = None) -> dict:
    """保存本机预算设置（原子写：临时文件 + os.replace）；返回规范化后的设置"""
    target = path or BUDGET_FILE
    normalized = normalize_budget(settings)
    os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
    tmp = f"{target}.{os.getpid()}.{time.time_ns()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(normalized, f, ensure_ascii=False, indent=2)
        os.replace(tmp, target)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    return normalized


def check_budget(
    estimate: float,
    settings: dict | None,
    spent_today: float,
    confirmed: bool = False,
) -> dict:
    """预算校验（纯函数）。

    规则：`singleRunLimit > 0` 且本次预估超限，或 `dailyLimit > 0` 且「当天已花 + 本次预估」超限
    → 判为超限（`over=True`）；此时仅当 `confirmed=True` 才放行。
    未配置（0）或未超限 → 直接放行。
    """
    cfg = normalize_budget(settings)
    est = max(0.0, _to_float(estimate))
    spent = max(0.0, _to_float(spent_today))
    single = cfg["singleRunLimit"]
    daily = cfg["dailyLimit"]

    reasons: list[str] = []
    if single > 0 and est > single:
        reasons.append(f"本次预估 {est:.2f} 元，超过单次上限 {single:.2f} 元")
    if daily > 0 and spent + est > daily:
        reasons.append(
            f"今日已花 {spent:.2f} 元 + 本次预估 {est:.2f} 元，超过当日预算 {daily:.2f} 元"
        )

    over = bool(reasons)
    limit = daily if daily > 0 else 0.0
    remaining = round(max(0.0, limit - spent), 2) if limit > 0 else 0.0
    return {
        "allowed": (not over) or bool(confirmed),
        "over": over,
        "confirmed": bool(confirmed),
        "reason": "；".join(reasons),
        "estimate": round(est, 2),
        "spentToday": round(spent, 2),
        "remaining": remaining,
        "settings": cfg,
    }
