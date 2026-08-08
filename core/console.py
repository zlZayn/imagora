#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""终端输出工具 —— 基于 rich 的统一控制台

CLI（main / batch / api）共用输出入口：彩色区分成功/失败/信息/次要，
批量进度用 Progress、任务分组用 Panel。无业务依赖，可被任意模块引用。
"""
from rich.console import Console
from rich.panel import Panel

console = Console()


def print_success(message: str) -> None:
    console.print(f"[bold green]{message}[/bold green]")


def print_error(message: str) -> None:
    console.print(f"[bold red]{message}[/bold red]")


def print_info(message: str) -> None:
    console.print(f"[cyan]{message}[/cyan]")


def print_dim(message: str) -> None:
    console.print(f"[dim]{message}[/dim]")


def print_panel(message: str, title: str | None = None, style: str = "green") -> None:
    """分组总结（成功/失败/预览），默认绿色边框"""
    console.print(Panel(message, title=title, style=style))
