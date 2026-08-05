#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gradio 网页界面 —— A站生图

启动: python main.py ui  （默认 http://127.0.0.1:7860）

功能:
  - 参考图：拖拽 / Ctrl+V 粘贴 / 点加号添加，多张则逐张生成
  - 不传图 = 文生图，传图 = 图生图
  - 提示词输入、尺寸 / 质量下拉、输出路径可改
"""
import os
import sys
import time
from pathlib import Path

import gradio as gr
from gradio import themes

from core.api import generate_image

_reconfigure = getattr(sys.stdout, "reconfigure", None)
if _reconfigure is not None:
    _reconfigure(encoding="utf-8")

DEFAULT_OUTPUT_DIR = str(Path.cwd() / "output")

# 尺寸下拉选项：显示标签，实际取 " " 前部分为分辨率
SIZE_OPTIONS = [
    "1024x1024 (1:1 1K)",
    "1024x1536 (2:3 竖版)",
    "1536x1024 (3:2 横版)",
    "1152x2048 (9:16 竖版长图)",
    "2048x1152 (16:9 横版)",
    "1024x1792 (竖版长图)",
    "1792x1024 (横版长图)",
]
# 各尺寸单张费用（元），用于界面预估提示
SIZE_COST = {
    "1024x1024": 0.05, "1024x1536": 0.10, "1536x1024": 0.10,
    "1152x2048": 0.10, "2048x1152": 0.10, "1024x1792": 0.10, "1792x1024": 0.10,
}


def extract_size_from_option(option):
    """从下拉标签（如 "1024x1024 (1:1 1K)"）取出分辨率字符串"""
    return option.split(" ")[0]


def generate_and_save(prompt, files, size_option, quality, output_dir):
    """界面回调：生成并保存图片，返回 (结果图列表, 状态文本)"""
    if not prompt.strip():
        return None, "请先输入提示词"
    size = extract_size_from_option(size_option)
    cost = SIZE_COST.get(size, 0.10)
    out_dir = output_dir.strip() or DEFAULT_OUTPUT_DIR
    os.makedirs(out_dir, exist_ok=True)

    results = []
    messages = []
    stamp = time.strftime("%Y%m%d_%H%M%S")

    if files:
        for i, file_path in enumerate(files):
            output_path = os.path.join(out_dir, f"img2img_{stamp}_{i}.png")
            messages.append(f"[{i + 1}/{len(files)}] 图生图 底图: {os.path.basename(str(file_path))}  预计 {cost} 元 ...")
            try:
                generate_image(
                    prompt=prompt, image_path=str(file_path), size=size,
                    quality=quality, output_format="png", output_path=output_path,
                )
                results.append(output_path)
                messages.append(f"[{i + 1}/{len(files)}] 已保存: {output_path}")
            except Exception as e:
                messages.append(f"[{i + 1}/{len(files)}] 失败: {type(e).__name__}: {str(e)[:150]}")
            time.sleep(3)
    else:
        output_path = os.path.join(out_dir, f"txt2img_{stamp}.png")
        messages.append(f"文生图  预计 {cost} 元 ...")
        try:
            generate_image(
                prompt=prompt, image_path=None, size=size,
                quality=quality, output_format="png", output_path=output_path,
            )
            results.append(output_path)
            messages.append(f"已保存: {output_path}")
        except Exception as e:
            messages.append(f"失败: {type(e).__name__}: {str(e)[:150]}")

    return results, "\n".join(messages)


def launch_ui():
    """启动 Gradio 服务并打开浏览器"""
    demo.launch(inbrowser=True, theme=themes.Soft())


with gr.Blocks(title="A站生图工具") as demo:
    gr.Markdown("# A站生图工具")
    gr.Markdown("文生图 / 图生图一体。参考图支持拖拽、Ctrl+V 粘贴或点加号添加；**不传图 = 文生图**。")
    with gr.Row():
        with gr.Column(scale=5):
            prompt = gr.Textbox(
                label="提示词", lines=4,
                placeholder="英文优先，减少歧义。例如：a red apple on white background, product photo",
            )
            files = gr.Files(label="参考图（可选，多张则逐张生成）", file_types=["image"], height=110)
            with gr.Row():
                size = gr.Dropdown(SIZE_OPTIONS, value=SIZE_OPTIONS[0], label="尺寸")
                quality = gr.Dropdown(["low", "medium", "high"], value="low", label="质量")
            output_dir = gr.Textbox(label="输出路径", value=DEFAULT_OUTPUT_DIR, placeholder="图片保存目录")
            btn = gr.Button("生成", variant="primary", scale=1)
            status = gr.Textbox(label="状态", interactive=False, lines=6)
        with gr.Column(scale=5):
            gallery = gr.Gallery(label="生成结果", columns=2, height=560)

    btn.click(
        fn=generate_and_save,
        inputs=[prompt, files, size, quality, output_dir],
        outputs=[gallery, status],
    )


if __name__ == "__main__":
    launch_ui()
