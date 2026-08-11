#!/usr/bin/env python3
"""终端输出工具 —— 基于 rich 的统一控制台

CLI（main / batch / api）共用输出入口。标签统一英文（[OK]/[ERROR]/[INFO]/[WARN]），
颜色为标准终端语义色（成功绿 / 失败红 / 警告琥珀 / 信息蓝 / 次要灰）。
批量进度用 Progress、任务分组用 Panel。无业务依赖，可被任意模块引用。
"""
from rich.console import Console
from rich.panel import Panel

console = Console()

# 语义色（标准终端语义：成功绿 / 失败红 / 警告琥珀 / 信息蓝 / 次要灰。
# 品牌主色不固定——网页端由窗口编号动态覆盖，终端只承担状态语义）
COLOR_OK = "#16a34a"
COLOR_ERR = "#dc2626"
COLOR_WARN = "#d97706"
COLOR_INFO = "#2563eb"
COLOR_DIM = "#6b7280"


def print_success(message: str) -> None:
    console.print(f"[bold {COLOR_OK}][OK] {message}[/bold {COLOR_OK}]")


def print_error(message: str) -> None:
    console.print(f"[bold {COLOR_ERR}][ERROR] {message}[/bold {COLOR_ERR}]")


def print_info(message: str) -> None:
    console.print(f"[{COLOR_INFO}][INFO] {message}[/{COLOR_INFO}]")


def print_warn(message: str) -> None:
    console.print(f"[{COLOR_WARN}][WARN] {message}[/{COLOR_WARN}]")


def print_dim(message: str) -> None:
    console.print(f"[{COLOR_DIM}]{message}[/{COLOR_DIM}]")


def print_panel(message: str, title: str | None = None, style: str = COLOR_OK) -> None:
    """分组总结（成功/失败/预览），默认标准绿边框"""
    console.print(Panel(message, title=title, style=style))
