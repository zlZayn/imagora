#!/usr/bin/env python3
"""终端输出工具 —— 基于 rich 的统一控制台

CLI（main / batch / api）共用输出入口。颜色语义与前端品牌一致：
成功=品牌绿 #3d7a5c / 失败=红 #dc2626 / 警告=琥珀 #d97706 / 信息=青蓝 #2563eb / 次要=灰 #6b7280。
批量进度用 Progress、任务分组用 Panel。无业务依赖，可被任意模块引用。
"""
from rich.console import Console
from rich.panel import Panel

console = Console()

# 语义色（与前端 index.css 的 --color-brand 同源，保持全链路一致）
COLOR_OK = "#3d7a5c"
COLOR_ERR = "#dc2626"
COLOR_WARN = "#d97706"
COLOR_INFO = "#2563eb"
COLOR_DIM = "#6b7280"


def print_success(message: str) -> None:
    console.print(f"[bold {COLOR_OK}]{message}[/bold {COLOR_OK}]")


def print_error(message: str) -> None:
    console.print(f"[bold {COLOR_ERR}]{message}[/bold {COLOR_ERR}]")


def print_info(message: str) -> None:
    console.print(f"[{COLOR_INFO}]{message}[/{COLOR_INFO}]")


def print_warn(message: str) -> None:
    console.print(f"[{COLOR_WARN}]{message}[/{COLOR_WARN}]")


def print_dim(message: str) -> None:
    console.print(f"[{COLOR_DIM}]{message}[/{COLOR_DIM}]")


def print_panel(message: str, title: str | None = None, style: str = COLOR_OK) -> None:
    """分组总结（成功/失败/预览），默认品牌绿边框"""
    console.print(Panel(message, title=title, style=style))
