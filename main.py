#!/usr/bin/env python3
"""Imagora 统一入口

用法（在 Imagora 目录运行）:
  python -m main ui                                                    # 启动网页界面
  python -m main menu --port 7860                                      # 交互菜单（启动脚本用）
  python -m main batch --config 项目/batch_prompts.json                # 批量生图
  python -m main batch --config 项目/batch_prompts.json --dry-run      # 预览不花钱
  python -m main gen "提示词" [-i 参考图] [-o 输出.png] [--ratio 9:16]  # 单张生图
"""
import argparse
import colorsys
import os
import sys
from pathlib import Path

from core import api
from core.batch import run_batch_generation
from core.config import DEFAULT_MODEL, DEFAULT_QUALITY, DEFAULT_TIER
from core.console import console, print_error, print_info, print_success

_reconfigure = getattr(sys.stdout, "reconfigure", None)
if _reconfigure is not None:
    _reconfigure(encoding="utf-8")


def accent_for_window(window_id: int | None) -> str:
    """窗口主题色（与 frontend/src/accent.ts 同算法）：
    hue = (windowId-1)*137.508 % 360，saturation 55%，lightness 42%。
    返回 #rrggbb，供菜单面板边框随窗口编号变色（多开一眼可辨）。
    """
    hue = ((window_id or 1) - 1) * 137.508 % 360
    r, g, b = colorsys.hls_to_rgb(hue / 360, 0.42, 0.55)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


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


def find_port_pid(port: int) -> int | None:
    """探测监听指定端口的进程 PID（服务状态的唯一真相源）。

    netstat 动态探测：不依赖临时 PID 文件，多开脚本 / 谁先谁后都不会失效。
    兼容双栈监听：IPv4/IPv6 可能各占一行且 PID 相同，取第一个即可。
    """
    pids = find_port_pids(port)
    return pids[0] if pids else None


def find_port_pids(port: int) -> list[int]:
    """探测监听指定端口的全部进程 PID（去重）。

    与 find_port_pid 的区别：Q 退出要「一次关闭全部」——同一端口可能因
    双栈监听（IPv4 + IPv6 两行）、多层包装（uv → python）、或历史残留
    出现多个不同 PID，逐个 taskkill /t 才能确保端口彻底释放。
    """
    import subprocess

    pids: list[int] = []
    try:
        out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, check=False).stdout
        for line in out.splitlines():
            if f":{port}" in line and "LISTENING" in line.upper():
                parts = line.split()
                if parts:
                    pid = int(parts[-1])
                    if pid not in pids:
                        pids.append(pid)
    except (OSError, ValueError):
        pass
    return pids


def _process_ancestors(pid: int) -> list[int]:
    """向上收集指定进程的完整祖先链（含自身），用于连根拔掉多层包装进程。

    典型场景：uv run python -m main ui 会产生 uv → python(shim) → python(监听) 多层，
    只杀监听层（taskkill /t 杀的是子进程树）会留下 uv/python 宿主残留。
    这里沿 ParentProcessId 逐级回溯到根，返回 [自身, 父, 祖父, ...]。
    逐级查询而非整表解析：避免 wmic 整表在不同 locale / 列宽下解析失真。
    """
    import subprocess

    chain: list[int] = []
    seen: set[int] = set()
    cur = pid
    while cur and cur not in seen:
        seen.add(cur)
        chain.append(cur)
        try:
            out = subprocess.run(
                ["wmic", "process", "where", f"ProcessId={cur}", "get", "ParentProcessId"],
                capture_output=True, text=True, check=False, timeout=5,
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            break
        parent = 0
        for line in out.splitlines():
            stripped = line.strip()
            if stripped.isdigit():
                parent = int(stripped)
                break
        cur = parent
    return chain


def stop_port_services(port: int) -> None:
    """停止监听指定端口的全部服务进程（一次关闭全部，连根拔）。

    找出端口上所有监听进程，并从每个监听 PID 向上收集完整祖先链
    （uv → python shim → python 监听），全部 taskkill /t——既杀监听层，
    也杀掉它的 uv/python 宿主，避免「端口释放了但进程残留」。
    """
    import subprocess

    pids = find_port_pids(port)
    if not pids:
        print_info("服务未在运行，无需停止")
        return
    # 收集所有监听 PID 的完整祖先链（去重），从根开始杀，保证整棵进程树覆灭
    kill_set: list[int] = []
    seen: set[int] = set()
    for pid in pids:
        for ancestor in _process_ancestors(pid):
            if ancestor not in seen:
                seen.add(ancestor)
                kill_set.append(ancestor)
    # 先杀最顶层祖先（uv），其 taskkill /t 会连带杀掉整棵子树
    for pid in kill_set:
        subprocess.run(["taskkill", "/pid", str(pid), "/f", "/t"], capture_output=True, check=False)
    print_success(f"服务已全部停止（PID {', '.join(str(p) for p in pids)}）")


def handle_menu_command(args):
    """交互菜单（rich 渲染）：N 开新窗口 / Q 退出并停止服务。

    由「启动生图工作台.cmd」调用：服务后台启动后就进入本菜单。
    - 服务状态实时探测：PID 用 netstat 找端口监听者，窗口数用 /api/status，
      不再依赖会被多开脚本互相覆盖的 PID 文件；
    - 关闭就关全部：无论按 Q 退出、Ctrl+C、还是直接点窗口右上角 X 关闭，
      都会停掉端口上的全部服务进程（双栈 / 多层 / 残留），所有窗口同时失效。
    """
    import time
    import webbrowser

    import requests
    from rich.panel import Panel
    from rich.prompt import Prompt
    from rich.table import Table

    url = f"http://127.0.0.1:{args.port}"

    # 兜底：Ctrl+C / 点 X 关窗口（控制台关闭事件）时也停掉全部服务。
    # Q 分支走主循环退出；这里的处理器覆盖「没走主循环就被终止」的路径，
    # 保证两种关闭方式都做到「一起关」。
    closed_by_handler = {"flag": False}
    handler_ref: dict[str, object] = {"fn": None}

    def _on_console_event(event_type: int) -> bool:
        # Windows 控制台事件：2=Ctrl+C / 5=CTRL_CLOSE_EVENT（点 X）/ 6=CTRL_LOGOFF_EVENT / 7=CTRL_SHUTDOWN_EVENT
        if event_type in (0, 2, 5, 6, 7) and not closed_by_handler["flag"]:
            closed_by_handler["flag"] = True
            try:
                stop_port_services(args.port)
            finally:
                if handler_ref["fn"] is not None:
                    try:
                        import ctypes

                        ctypes.windll.kernel32.SetConsoleCtrlHandler(handler_ref["fn"], False)
                    except Exception:
                        pass  # 进程即将退出，卸载 handler 失败无害
        return False

    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import WINFUNCTYPE, c_bool, c_uint

            _HandlerRoutine = WINFUNCTYPE(c_bool, c_uint)
            fn = _HandlerRoutine(_on_console_event)
            handler_ref["fn"] = fn
            # 注册控制台事件处理器：返回非零表示「已处理」；这里返回 False 交给默认处理
            ctypes.windll.kernel32.SetConsoleCtrlHandler(fn, True)
        except Exception:
            handler_ref["fn"] = None

    def fetch_window_count() -> int:
        try:
            resp = requests.get(f"{url}/api/status", timeout=5)
            return int(resp.json().get("windowCounter", 0))
        except Exception:
            return 0

    def render_status_panel() -> Panel:
        pid = find_port_pid(args.port)
        win_count = fetch_window_count()
        running = pid is not None
        # 边框颜色随窗口主题色（accent.ts 同算法）：不同窗口号不同色相
        accent = accent_for_window(win_count)
        table = Table(show_header=False, box=None, padding=(0, 2))
        table.add_column(style="bold", justify="right", width=10)
        table.add_column(style="white")
        table.add_row("服务地址", f"[bold {accent}]{url}[/bold {accent}]")
        table.add_row("服务进程", f"PID {pid}" if running else "[#d97706]未运行[/#d97706]")
        table.add_row("已开窗口", f"编号已分配至 #{win_count}" if win_count else "暂无")
        return Panel(
            table,
            title=f"[bold {accent}]Imagora · AI 生图工作台[/bold {accent}]",
            border_style=accent if running else "#d97706",
            subtitle="[#6b7280]操作：[/#6b7280][bold]N[/bold] 打开新窗口   [bold]Q[/bold] 退出并停止服务",
            padding=(1, 2),
        )

    try:
        while True:
            console.print(render_status_panel())
            choice = Prompt.ask(
                "[bold]选择操作[/bold]（[bold]N[/bold] 打开新窗口 / [bold]Q[/bold] 退出并停止服务）",
                choices=["N", "Q"],
                default="N",
            )
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
    finally:
        # 无论按 Q 退出、Ctrl+C、点 X 关窗口（控制台关闭事件）、还是异常终止，
        # 都统一停掉端口上的全部服务进程（一次关闭全部）。
        if not closed_by_handler["flag"]:
            closed_by_handler["flag"] = True
            try:
                stop_port_services(args.port)
            finally:
                # 释放控制台事件处理器，避免重复注册
                if handler_ref["fn"] is not None:
                    try:
                        import ctypes

                        ctypes.windll.kernel32.SetConsoleCtrlHandler(handler_ref["fn"], False)
                    except Exception:
                        pass  # 进程即将退出，卸载 handler 失败无害


def build_argument_parser():
    """构建命令行参数解析器"""
    parser = argparse.ArgumentParser(description="Imagora · AI 生图工作台")
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
    sub_gen.add_argument("--tier", default=DEFAULT_TIER, choices=["1K", "2K", "4K"], help="配合 --ratio 的档位，默认 2K")
    sub_gen.add_argument("--quality", default=DEFAULT_QUALITY, choices=["low", "medium", "high"], help="质量，默认 high")
    sub_gen.add_argument("--model", default=DEFAULT_MODEL, help="模型名")
    sub_gen.add_argument("--n", type=int, default=1, help="生成张数，默认 1")
    sub_gen.add_argument("--format", default="png", choices=["png", "jpg", "webp"], help="输出格式，默认 png")
    sub_gen.set_defaults(handler=handle_gen_command)

    return parser


def main():
    parser = build_argument_parser()
    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
