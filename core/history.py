"""本地生成历史读取：容忍损坏 JSONL，支持轻量筛选。"""
import hashlib
import json
import os
import re
import shutil
import time
from pathlib import Path

from core import registry
from core.config import WORK_ROOT
from core.logging import LOGS_DIR

HISTORY_FILE = LOGS_DIR / "generation.jsonl"

# 搜索空白折叠：账本 prompt 存 Windows CRLF（表单提交 %0D%0A），用户粘进单行搜索框时
# 浏览器把换行归一/移除，与账本换行错位导致整串子串匹配失败——两侧统一折叠为单空格。
_SPACES = re.compile(r"\s+")


def read_generation_history(
    limit: int = 200,
    query: str = "",
    status: str = "",
) -> list[dict]:
    """返回最新生成记录；坏行被忽略，单次最多 500 条。"""
    safe_limit = min(500, max(1, int(limit)))
    # 两侧都做空白折叠（CRLF/LF/连续空格 → 单空格），换行差异不再导致整串匹配失败
    needle = _SPACES.sub(" ", query.strip()).casefold()
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
                _SPACES.sub(" ", str(record.get(key, "")))
                for key in ("time", "prompt", "mode", "quality", "output")
            ).casefold()
            if needle not in haystack:
                continue
        items.append(record)
        if len(items) >= safe_limit:
            break
    return items



# ================= 历史账本迁移（core.history 自带，供 scripts/migrate.py 调用） =================

def resolve_output_path(output: str) -> str:
    """把账本里的 output 路径解析为绝对路径（相对路径按 WORK_ROOT 拼接）。

    与 server 旧实现逻辑一致；server 已委托本函数，避免两处分叉。
    """
    raw = str(output or "").strip()
    if not raw:
        return ""
    return os.path.normpath(raw if os.path.isabs(raw) else str(WORK_ROOT / raw))


def _mig_ts() -> str:
    import time
    return time.strftime("%Y%m%d-%H%M%S")


def backfill_output_asset_ids(apply: bool = False) -> dict:
    """历史旧行（缺 outputAssetIds）按 output 文件内容反查注册表补齐 id。

    安全语义（与迁移家族一致）：
      - 默认只报告：扫描并说明多少行可补/无法反查/已具备，不写文件；
      - apply 才落盘：先整文件备份 .bak-<ts>，原子写（tmp+os.replace），读回校验行数不变；
      - 只补能可靠反查的行（output 文件在 + 内容 sha1 命中注册表）；其余跳过并计数，绝不猜；
      - 幂等：已有 outputAssetIds 的行不动，重复执行结果不变。
    返回 {"action", "backfill", "unable", "already", "backup", "lines"}。
    """
    if not HISTORY_FILE.exists():
        return {"action": "nothing", "rows": 0}
    lines = HISTORY_FILE.read_text(encoding="utf-8").splitlines()
    entries = registry.load_registry()
    out = list(lines)
    backfill = 0
    unable = 0
    already = 0
    for i, line in enumerate(lines):
        try:
            rec = json.loads(line)
        except (TypeError, ValueError):
            continue  # 坏行原样保留
        if not isinstance(rec, dict):
            continue
        if rec.get("outputAssetIds"):
            already += 1
            continue
        abs_path = resolve_output_path(rec.get("output", ""))
        filled = False
        if abs_path and os.path.isfile(abs_path):
            try:
                with open(abs_path, "rb") as f:
                    content = f.read()
                img_id = hashlib.sha1(content).hexdigest()[:12]
                if img_id in entries:
                    rec = {**rec, "outputAssetIds": [img_id]}
                    out[i] = json.dumps(rec, ensure_ascii=False)
                    filled = True
                    backfill += 1
            except OSError:
                pass
        if not filled:
            unable += 1
    if not apply:
        return {"action": "report", "backfill": backfill, "unable": unable, "already": already}
    backup = None
    if os.path.isfile(HISTORY_FILE):
        backup = f"{HISTORY_FILE}.bak-{_mig_ts()}"
        shutil.copy2(HISTORY_FILE, backup)
    tmp = f"{HISTORY_FILE}.{os.getpid()}.{time.time_ns()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("\n".join(out))
            if out:
                f.write("\n")
        os.replace(tmp, HISTORY_FILE)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    after = HISTORY_FILE.read_text(encoding="utf-8").splitlines()
    ok = len(after) == len(lines) and sum(1 for l in after if '"outputAssetIds"' in l) >= backfill
    return {
        "action": "backfilled" if ok else "FAILED-VERIFY",
        "backfill": backfill,
        "unable": unable,
        "already": already,
        "backup": backup,
        "lines": len(after),
    }
