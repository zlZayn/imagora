#!/usr/bin/env python3
"""Imagora 存储迁移工具（通用名，脚本壳）：一步到最新。

把任意历史版本留下的数据一步迁到最新格式：
  1. 注册表：目录 .canvas->.assets（重写 relPath）、v1->v2、重建损坏清单、回填 kind（core.registry.migrate）
  2. 工作流：v1->v2（补 version+savedAt，备份+校验）（core.graphstore.migrate_workflows）

安全语义：默认只报告（不写任何文件）；--apply 才落盘且先整目录/文件备份、写后加载器读回校验、幂等。

用法：
  python scripts/migrate.py
  python scripts/migrate.py --apply
  python scripts/migrate.py --apply --rebuild-registry
  python scripts/migrate.py --apply --output-root 路径
"""
import argparse
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import canvas as canvas_mod
from core import graphstore
from core import registry


def _milestone(rel, reg, am):
    out = []
    if rel.get('action') == 'noop':
        out.append('[目录] .assets 已是规范名')
    elif rel.get('action') == 'nothing':
        out.append(f"[目录] 无存量 .canvas（{rel.get('reason')}）")
    elif rel.get('action') == 'ready':
        out.append(f"[目录] 待迁 .canvas->.assets（{rel.get('files')} 文件，加 --apply）")
    elif rel.get('action') == 'moved':
        out.append(f"[目录] 已迁 {rel.get('files')} 文件，备份: {rel.get('backup')}")
    a = reg.get('action', '')
    if a == 'none':
        out.append(f"[注册表] {reg.get('registry', {}).get('state')} 无需迁移")
    elif a == 'pending-relocate':
        s = reg.get('registry', {})
        out.append(f"[注册表] {s.get('state')} 待迁目录后升级（{s.get('count', 0)} 条，加 --apply）")
    elif a:
        out.append(f"[注册表] {a}（{reg.get('entries', '')} 条）")
    if am.get('action') == 'noop':
        out.append('[来源标签] 全部已带 kind')
    elif am.get('action'):
        out.append(f"[来源标签] {am.get('action')}（{am.get('backfilled', 0)} 条）")
    return '\n'.join(out)


def _print_report(report) -> None:
    mode = '落地(apply，含备份与校验)' if report.get('apply') else '只报告（不写文件）'
    print(f'模式：{mode}')
    print(_milestone(report.get('relocate') or {}, report.get('registry') or {}, report.get('asset_meta') or {}))
    s = report.get('summary') or {}
    print(f"[工作流] 待升级/已升级 {s.get('upgraded', 0)} · 无需动 {s.get('noop', 0)} · 损坏跳过 {s.get('corrupt', 0)}")


def main() -> int:
    parser = argparse.ArgumentParser(description='Imagora 存储迁移：一步到最新（默认只报告，--apply 才落地备份校验）')
    parser.add_argument('--apply', action='store_true', help='落地迁移（先备份 .bak-<时间戳>，校验通过才保留）')
    parser.add_argument('--rebuild-registry', action='store_true', help='注册表缺失/损坏时按 .assets 图片文件重建')
    parser.add_argument('--skip-meta-backfill', action='store_true', help='跳过来源标签(kind)回填')
    parser.add_argument('--output-root', default=None, help='output 根目录（默认取配置 DEFAULT_OUTPUT_DIR）')
    args = parser.parse_args()

    if args.output_root:
        root = os.path.abspath(args.output_root)
        for mod in (registry, graphstore, canvas_mod):
            mod.DEFAULT_OUTPUT_DIR = root
        registry.ASSET_DIR = os.path.join(root, '.assets')
        registry.REGISTRY_FILE = os.path.join(registry.ASSET_DIR, 'registry.json')
        registry.LEGACY_ASSET_DIR = os.path.join(root, '.canvas')
        graphstore.WORKFLOWS_DIR = os.path.join(root, 'workflows')
        graphstore.RECOVERY_DIR = os.path.join(graphstore.WORKFLOWS_DIR, '.recovery')

    reg_report = registry.migrate(apply=args.apply, rebuild=args.rebuild_registry, backfill=not args.skip_meta_backfill)
    wf_report = graphstore.migrate_workflows(apply=args.apply)
    combined = {**reg_report, **wf_report, 'apply': args.apply}
    _print_report(combined)
    return 0


if __name__ == '__main__':
    sys.exit(main())
