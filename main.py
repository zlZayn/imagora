#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A站生图统一入口

用法（在网店实习根目录运行）:
  python tools/main.py ui                                                    # 启动网页界面
  python tools/main.py batch --config 项目/batch_prompts.json                # 批量生图
  python tools/main.py batch --config 项目/batch_prompts.json --dry-run      # 预览不花钱
  python tools/main.py gen "提示词" [-i 参考图] [-o 输出.png] [--ratio 9:16]  # 单张生图
"""
import argparse
import os
import sys
from pathlib import Path

from core import api
from core.batch import run_batch_generation

_reconfigure = getattr(sys.stdout, "reconfigure", None)
if _reconfigure is not None:
    _reconfigure(encoding="utf-8")


def handle_ui_command(args):
    """启动 Web 界面（FastAPI 托管前端构建产物）"""
    import threading
    import webbrowser

    import uvicorn

    from server import app

    url = f"http://127.0.0.1:{args.port}"
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port)


def handle_batch_command(args):
    """执行批量生图"""
    config_path = Path(args.config) if args.config else (Path.cwd() / "batch_prompts.json")
    if not config_path.exists():
        sys.exit(f"未找到配置文件: {config_path}，请用 --config 指定项目配置路径")
    failed = run_batch_generation(config_path, module_filter=args.only, dry_run=args.dry_run)
    if failed:
        sys.exit(1)


def handle_gen_command(args):
    """单张生图（文生图 / 图生图）"""
    output_format = args.format if args.output is None else os.path.splitext(args.output)[1].lstrip(".") or args.format
    size = api.resolve_size_with_ratio(args.size, args.ratio, args.tier)
    output_path = api.build_default_output_path(args.output, output_format)
    api.generate_image(
        prompt=args.prompt,
        image_path=args.image,
        size=size,
        quality=args.quality,
        model=args.model,
        n=args.n,
        output_format=output_format,
        output_path=output_path,
    )


def build_argument_parser():
    """构建命令行参数解析器"""
    parser = argparse.ArgumentParser(description="A站生图工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sub_ui = subparsers.add_parser("ui", help="启动网页界面")
    sub_ui.add_argument("--port", type=int, default=7860, help="监听端口（默认 7860）")
    sub_ui.set_defaults(handler=handle_ui_command)

    sub_batch = subparsers.add_parser("batch", help="批量生图")
    sub_batch.add_argument("--config", help="项目配置文件 batch_prompts.json 路径（默认找当前目录）")
    sub_batch.add_argument("--only", help="只跑指定模块号，逗号分隔，如 2,4")
    sub_batch.add_argument("--dry-run", action="store_true", help="只预览配置与成本，不调用 API")
    sub_batch.set_defaults(handler=handle_batch_command)

    sub_gen = subparsers.add_parser("gen", help="单张生图")
    sub_gen.add_argument("prompt", help="提示词（英文优先）")
    sub_gen.add_argument("-i", "--image", help="参考图路径（可选；传了=图生图）")
    sub_gen.add_argument("-o", "--output", help="输出路径（默认 output/ai_时间戳.png）")
    sub_gen.add_argument("--size", default=None, help="分辨率（与 --ratio 二选一，默认 1024x1024）")
    sub_gen.add_argument("--ratio", default=None, help="宽高比：1:1 / 3:2 / 2:3 / 16:9 / 9:16 / 7:4 / 4:7")
    sub_gen.add_argument("--tier", default="2K", choices=["1K", "2K", "4K"], help="配合 --ratio 的档位，默认 2K")
    sub_gen.add_argument("--quality", default="low", choices=["low", "medium", "high"])
    sub_gen.add_argument("--model", default="gpt-image-2")
    sub_gen.add_argument("--n", type=int, default=1)
    sub_gen.add_argument("--format", default="png", choices=["png", "jpg", "webp"])
    sub_gen.set_defaults(handler=handle_gen_command)

    return parser


def main():
    parser = build_argument_parser()
    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
