#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A站生图统一入口

用法（在网店实习根目录运行）:
  python tools/main.py ui                                                    # 启动网页界面
  python tools/main.py menu --port 7860                                      # 交互菜单（启动脚本用）
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
from core.console import console, print_error, print_info, print_success

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
    print_success(f"服务已启动: {url}")
    if not getattr(args, "no_browser", False):
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port)


def handle_batch_command(args):
    """执行批量生图"""
    config_path = Path(args.config) if args.config else (Path.cwd() / "batch_prompts.json")
    if not config_path.exists():
        print_error(f"未找到配置文件: {config_path}，请用 --config 指定项目配置路径")
        sys.exit(1)
    failed = run_batch_generation(config_path, module_filter=args.only, dry_run=args.dry_run)
    if failed:
        print_error(f"批量结束 · {len(failed)} 张失败")
        sys.exit(1)


def handle_gen_command(args):
    """单张生图（文生图 / 图生图）"""
    import time

    from core.logging import log_generation

    output_format = args.format if args.output is None else os.path.splitext(args.output)[1].lstrip(".") or args.format
    size = api.resolve_size_with_ratio(args.size, args.ratio, args.tier)
    output_path = api.build_default_output_path(args.output, output_format)
    started_at = time.time()
    try:
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
        job_ok = True
    except Exception as e:
        job_ok = False
        print_error(f"生成失败: {api.format_error(e)}")
    finally:
        log_generation(
            prompt=args.prompt,
            mode="img2img" if args.image else "txt2img",
            refs=1 if args.image else 0,
            size=size,
            quality=args.quality,
            status="ok" if job_ok else "error",
            output=output_path if job_ok else "",
            cost=0.0,
            seconds=time.time() - started_at,
        )
    if not job_ok:
        sys.exit(1)


def handle_menu_command(args):
    """交互菜单（rich 渲染）：N 开新窗口 / Q 退出（停止脚本启动的服务）。

    由「启动生图工具.cmd」调用：服务后台启动后就进入本菜单。
    服务进程 PID 由脚本写入 %TEMP%/aig_pid_{port}.txt；文件不存在说明是既有服务，Q 不误杀。
    """
    import subprocess
    import time
    import webbrowser

    import requests
    from rich.panel import Panel
    from rich.prompt import Prompt

    url = f"http://127.0.0.1:{args.port}"
    pid_file = Path(os.environ.get("TEMP", "/tmp")) / f"aig_pid_{args.port}.txt"

    def read_pid() -> int | None:
        try:
            return int(pid_file.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            return None

    print_success(f"服务已就绪: {url}")
    while True:
        console.print(
            Panel(
                "[green]N[/green] 打开新窗口\n"
                "[red]Q[/red] 退出",
                title="Image Tool",
                style="green",
            )
        )
        choice = Prompt.ask("选择操作", choices=["N", "Q"], default="N")
        if choice == "Q":
            break
        try:
            resp = requests.get(f"{url}/api/window/next", timeout=5)
            win = resp.json()["windowId"]
            webbrowser.open(f"{url}/?win={win}")
            print_success(f"已打开窗口 #{win}")
        except Exception as e:
            print_error(f"开新窗口失败: {e}")
            time.sleep(2)

    pid = read_pid()
    if pid:
        subprocess.run(["taskkill", "/pid", str(pid), "/f", "/t"], capture_output=True)
        print_info("服务已停止")
    else:
        print_info("既有服务保持运行，未停止")


def build_argument_parser():
    """构建命令行参数解析器"""
    parser = argparse.ArgumentParser(description="A站生图工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sub_ui = subparsers.add_parser("ui", help="启动网页界面")
    sub_ui.add_argument("--port", type=int, default=7860, help="监听端口（默认 7860）")
    sub_ui.add_argument("--no-browser", action="store_true", help="不自动打开浏览器（由外部脚本控制开窗）")
    sub_ui.set_defaults(handler=handle_ui_command)

    sub_menu = subparsers.add_parser("menu", help="交互菜单（启动脚本用）：N 开新窗口 / Q 退出")
    sub_menu.add_argument("--port", type=int, default=7860, help="监听端口（默认 7860）")
    sub_menu.set_defaults(handler=handle_menu_command)

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
