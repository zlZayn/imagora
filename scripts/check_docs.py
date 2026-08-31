#!/usr/bin/env python3
"""文档完整性校验：相对链接可解析 + 仪表盘测试计数与源码一致。

只读、无副作用（不写任何文件），本地与 CI 均可跑：
    python scripts/check_docs.py [--quiet]
退出码 0 = 全部通过；1 = 有断链 / 计数漂移（输出明细）。

背景：文档体系要求「改任何文档后复查链接可解析、仪表盘数字不过时」
（根 AGENTS.md 互改联动）。测试计数分散在 AGENTS / tests/README /
ARCHITECTURE / frontend/README 多处，人工同步易漏（曾出现 221→222
漏改、frontend 145 过时数字等漂移）。本脚本把「数字与源码一致」
从纪律变成可执行检查：后端数解 pytest 的 def test_，前端数解 vitest
的 it()，再与各文档声明的数字逐处比对。
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 递归跳过目录（node_modules 等大目录不进扫描）
_SKIP_DIRS = {".git", "node_modules", "dist", ".venv", "output", "logs"}

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def doc_markdown_files() -> list[pathlib.Path]:
    """项目内所有 doc 系 markdown（递归，跳过大目录）。"""
    files = []
    for p in ROOT.rglob("*.md"):
        rel = p.relative_to(ROOT)
        if any(part in _SKIP_DIRS for part in rel.parts):
            continue
        files.append(p)
    return sorted(files)


def check_links() -> list[str]:
    """相对 markdown 链接可解析：逐 md 提取 [text](target)，跳过外链/锚点/占位。"""
    problems: list[str] = []
    checked = 0
    for md in doc_markdown_files():
        try:
            text = md.read_text(encoding="utf-8")
        except OSError as exc:
            problems.append(f"{md.relative_to(ROOT)}: 读取失败 {exc}")
            continue
        for m in LINK_RE.finditer(text):
            target = m.group(1).strip()
            if not target or target.startswith(("http://", "https://", "mailto:", "#", "<")):
                continue
            path_part = target.split("#", 1)[0].strip()
            if not path_part:
                continue
            path_part = path_part.strip("<>")  # <path> 形式角括号包裹
            if not (md.parent / path_part).resolve().exists():
                line = text.count("\n", 0, m.start()) + 1
                problems.append(f"{md.relative_to(ROOT)}:{line} 断链 → {target}")
            checked += 1
    return checked, problems


def count_backend_tests() -> tuple[int, dict[str, int]]:
    """tests/test_*.py 的 def test_ 函数数（与 pytest 收集口径一致）。"""
    total = 0
    per_file: dict[str, int] = {}
    for py in sorted((ROOT / "tests").glob("test_*.py")):
        n = sum(
            1
            for line in py.read_text(encoding="utf-8").splitlines()
            if re.match(r"^\s*def\s+test_", line)
        )
        per_file[py.name] = n
        total += n
    return total, per_file


def count_frontend_tests() -> int:
    """frontend/src 下 *.test.ts* 的 it() / it.each() 数（vitest 用例口径）。"""
    total = 0
    for ts in sorted((ROOT / "frontend" / "src").rglob("*.test.ts*")):
        text = ts.read_text(encoding="utf-8")
        total += len(re.findall(r"\bit\(|it\.each\(", text))
    return total


# 计数声明点：文本模式 → 期望的计数类型（backend/frontend）。
# 每处模式必须恰好命中且数值与源码一致；模式改写法导致匹配不到会报错（防校验空转）。
COUNT_PATTERNS: list[tuple[pathlib.Path, str, str]] = [
    (ROOT / "tests" / "README.md", r"# 后端全量（(\d+) 用例）", "backend"),
    (ROOT / "tests" / "README.md", r"## 文件索引（后端 pytest，共 (\d+)）", "backend"),
    (ROOT / "tests" / "README.md", r"## 文件索引（前端 vitest，共 (\d+)", "frontend"),
    (ROOT / "AGENTS.md", r"后端 pytest：\*\*(\d+) passed\*\*", "backend"),
    (ROOT / "AGENTS.md", r"前端 vitest：\*\*(\d+) passed\*\*", "frontend"),
    (ROOT / "docs" / "ARCHITECTURE.md", r"后端 pytest：\*\*(\d+) 用例\*\*", "backend"),
    (ROOT / "docs" / "ARCHITECTURE.md", r"前端 vitest：\*\*(\d+) 用例\*\*", "frontend"),
    (ROOT / "docs" / "ARCHITECTURE.md", r"后端 pytest（(\d+) 用例）", "backend"),
    (ROOT / "docs" / "ARCHITECTURE.md", r"前端 vitest（(\d+) 用例）", "frontend"),
    (ROOT / "frontend" / "README.md", r"vitest run（(\d+) 用例）", "frontend"),
]

# tests/README.md 逐文件表格：| [`test_xxx.py`](...) | N | ... |
TABLE_ROW_RE = re.compile(r"\|\s*\[`([^`]+)`\]\([^)]*\)\s*\|\s*(\d+)\s*\|")


def check_counts(backend_total: int, per_file: dict[str, int], frontend_total: int) -> list[str]:
    """逐文件表格 + 各声明点计数与源码一致。"""
    problems: list[str] = []
    expected = {"backend": backend_total, "frontend": frontend_total}

    # tests/README.md 表格逐行比对
    readme = (ROOT / "tests" / "README.md").read_text(encoding="utf-8")
    for m in TABLE_ROW_RE.finditer(readme):
        name, declared = m.group(1), int(m.group(2))
        if name.endswith(".py"):
            actual = per_file.get(name)
            if actual is None:
                problems.append(f"tests/README.md 表格含未知后端文件 {name}")
            elif actual != declared:
                problems.append(f"tests/README.md 声称 {name}={declared}，实际 {actual}")
        elif name.endswith((".test.ts", ".test.tsx")):
            # 前端逐文件数不细拆（it 计数已算总数），只校验文件存在由链接检查兜底
            pass

    # 各处总数声明
    for path, pattern, kind in COUNT_PATTERNS:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            problems.append(f"{path.relative_to(ROOT)}: 读取失败 {exc}")
            continue
        matches = re.findall(pattern, text)
        if not matches:
            problems.append(f"{path.relative_to(ROOT)}: 未找到计数声明（模式 {pattern!r}）")
            continue
        for value in matches:
            if int(value) != expected[kind]:
                problems.append(
                    f"{path.relative_to(ROOT)}: {kind} 计数声明 {value}，实际 {expected[kind]}（模式 {pattern!r}）"
                )
    return problems


def main() -> int:
    # GBK 控制台（Windows 默认 cp936）无法打印 ✔/❌，统一按 utf-8 输出
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quiet", action="store_true", help="只输出问题，不输出通过摘要")
    args = parser.parse_args()

    checked, link_problems = check_links()
    backend_total, per_file = count_backend_tests()
    frontend_total = count_frontend_tests()
    count_problems = check_counts(backend_total, per_file, frontend_total)

    problems = link_problems + count_problems
    for p in problems:
        print(f"❌ {p}")
    if not problems:
        if not args.quiet:
            print(
                f"✔ 全部通过：链接 {checked} 处可解析；"
                f"后端 {backend_total} / 前端 {frontend_total} 计数与文档一致"
            )
        return 0
    print(f"共 {len(problems)} 处问题", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())