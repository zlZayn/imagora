#!/usr/bin/env python3
"""Imagora 画布存储迁移工具（独立脚本，随仓库提交）。

把 v1 老格式（无 schemaVersion 的注册表 / version 1 工作流）一键升级为 v2：
  - 注册表：包装为 {schemaVersion: 2, images: {...}}，逐条按文件补宽高/格式
  - 工作流：补 version 2 与 savedAt
安全语义：默认只报告（不写任何文件）；--apply 才落盘，且先备份为 .bak-<时间戳>、
写后用应用自身加载器读回校验通过才保留；--rebuild-registry 在清单缺失/损坏时按
.canvas 下图片文件重建 v2 清单。迁移后 v1/v2 都被程序兼容读取，数据零丢失。

用法：
  python scripts/migrate_canvas_v2.py                 # 只报告将迁移什么
  python scripts/migrate_canvas_v2.py --apply         # 落地迁移（含备份与校验）
  python scripts/migrate_canvas_v2.py --apply --rebuild-registry   # 同时重建损坏清单
"""
import argparse
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import canvas as canvas_mod
from core import migrate


def _print_report(report: dict) -> None:
    print(f"模式：{'落地(apply，含备份与校验)' if report['apply'] else '只报告（不写文件）'}")
    am = report.get("asset_meta", {})
    if am.get("action") == "noop":
        print(f"[来源标签] 全部条目已带 kind（{am['asset_meta']['count']} 条，无需回填）")
    elif am.get("action") == "backfill-ready":
        print(f"[来源标签] {am['backfilled']} 条缺 kind → 待回填 canvas（加 --apply 执行）")
    elif am.get("action") == "backfilled":
        print(f"[来源标签] 已回填 {am['backfilled']} 条 kind=canvas，备份: {am['backup']}")
    elif am.get("action") == "none":
        print(f"[来源标签] 注册表不可迁移，跳过（{am.get('asset_meta', {}).get('state')}）")
    reg = report["registry"]
    if reg.get("action") == "none":
        print(f"[注册表] {reg['registry']['state']}（{reg['registry']['count']} 条，无需迁移）")
    elif reg.get("action") == "upgrade-to-v2":
        print(f"[注册表] v1（{reg['entries']} 条）→ 待升级为 v2（加 --apply 执行）")
    elif reg.get("action") == "upgraded-to-v2":
        print(f"[注册表] 已升级为 v2（{reg['entries']} 条），备份: {reg['backup']}")
    elif reg.get("action") == "rebuild-ready":
        print(f"[注册表] 缺失/损坏，可从图片文件重建 {reg['restored']} 条（加 --apply 执行）")
    elif reg.get("action") == "rebuilt":
        print(f"[注册表] 已按图片文件重建 v2 清单（{reg['restored']} 条）")
    elif reg.get("action") == "nothing-to-rebuild":
        print("[注册表] 缺失/损坏且 .canvas 下无图片文件，无需重建")
    else:
        print(f"[注册表] 状态: {reg}")

    for r in report["workflows"]:
        if r.get("action") == "noop":
            print(f"[工作流] {r['name']} v{r['version']} 已是最新")
        elif r.get("action") == "upgrade-ready":
            print(f"[工作流] {r['name']} v{r['version']} → 待升级（加 --apply 执行）")
        elif r.get("action") == "upgraded":
            print(f"[工作流] {r['name']} 已升级 v{r['version']}，备份: {r['backup']}")
        elif r.get("action") == "skip-corrupt":
            print(f"[工作流] {r['name']} 无法读取（跳过）")
        else:
            print(f"[工作流] {r['name']} {r['action']}")

    s = report["summary"]
    print(
        f"\n汇总：待升级/已升级 {s['upgraded']}，无需动 {s['noop']}，"
        f"剩余 v1 {s['v1_remaining']}，损坏跳过 {s['corrupt']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Imagora 画布存储迁移：v1 → v2（默认只报告，--apply 才落地并备份校验）",
    )
    parser.add_argument("--apply", action="store_true", help="落地迁移（先备份 .bak-<时间戳>，校验通过才保留）")
    parser.add_argument("--rebuild-registry", action="store_true", help="清单缺失/损坏时按图片文件重建 v2 清单")
    parser.add_argument("--skip-meta-backfill", action="store_true", help="跳过来源标签(kind)回填")
    parser.add_argument("--output-root", default=None, help="output 根目录（默认取配置 DEFAULT_OUTPUT_DIR）")
    args = parser.parse_args()

    if args.output_root:
        old = canvas_mod.DEFAULT_OUTPUT_DIR
        canvas_mod.DEFAULT_OUTPUT_DIR = os.path.abspath(args.output_root)
        canvas_mod.CANVAS_DIR = os.path.join(canvas_mod.DEFAULT_OUTPUT_DIR, ".canvas")
        canvas_mod.REGISTRY_FILE = os.path.join(canvas_mod.CANVAS_DIR, "registry.json")
        canvas_mod.WORKFLOWS_DIR = os.path.join(canvas_mod.DEFAULT_OUTPUT_DIR, "workflows")
        canvas_mod.RECOVERY_DIR = os.path.join(canvas_mod.WORKFLOWS_DIR, ".recovery")
        importlib.reload(migrate)  # 让迁移模块读取更新后的常量
        if old == canvas_mod.DEFAULT_OUTPUT_DIR:
            print(f"output 根不变：{old}", file=sys.stderr)

    report = migrate.plan_or_apply(
        apply=args.apply, rebuild=args.rebuild_registry, backfill=not args.skip_meta_backfill,
    )
    _print_report(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())