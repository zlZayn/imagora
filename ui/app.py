#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gradio 网页界面 —— A站生图

启动: python main.py ui  （默认 http://127.0.0.1:7860）

功能:
  - 参考图：拖拽 / Ctrl+V 粘贴 / 点击添加，多张则逐张生成
  - 不传图 = 文生图，传图 = 图生图
  - 提示词输入、尺寸 / 质量下拉
  - 输出路径可手输或点击"选择文件夹"打开系统目录选择器
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

# 顶部：SVG 图标（lucide leaf）+ 标题
HEADER_HTML = """
<div id="title-block">
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#3d7a5c"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </svg>
  <h1>A站生图工具</h1>
</div>
"""

CUSTOM_CSS = """
.gradio-container { max-width: 1400px !important; margin: 0 auto !important; }
#title-block { display: flex; align-items: center; gap: 10px; padding: 6px 0 2px; }
#title-block h1 { margin: 0; font-size: 1.45rem !important; }
footer { display: none !important; }
/* 融合卡片：内部组件去独立边框，视觉连成一块 */
.gr-group { border-radius: 10px; }
.gr-group .form { box-shadow: none !important; border: none !important; }
/* 紧凑：压缩块间距，减少割裂 */
.block { gap: 4px; }
textarea, input { font-size: 0.95rem !important; }
.gr-file { min-height: 88px !important; }
button.primary { font-weight: 600; }
"""


def extract_size_from_option(option):
    """从下拉标签（如 "1024x1024 (1:1 1K)"）取出分辨率字符串"""
    return option.split(" ")[0]


def select_output_folder(current_dir):
    """弹出系统文件夹选择器，选中的路径回填；取消则保留原值"""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="选择输出文件夹")
        root.destroy()
        return folder if folder else current_dir
    except Exception:
        return current_dir


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
            messages.append(f"[{i + 1}/{len(files)}] 图生图 底图: {os.path.basename(str(file_path))}  预计 {cost} 元")
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
        messages.append(f"文生图  预计 {cost} 元")
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


def build_ui():
    """构建界面"""
    with gr.Blocks(title="A站生图工具") as demo:
        gr.HTML(HEADER_HTML)
        gr.Markdown("文生图 / 图生图一体。参考图支持拖拽、Ctrl+V 粘贴或点击添加；不传图即为文生图。")

        with gr.Row(equal_height=True):
            # 左侧：输入面板
            with gr.Column(scale=5, min_width=360):
                # 内容卡：提示词 + 参考图 融合一体
                with gr.Group():
                    prompt = gr.Textbox(
                        label="提示词", lines=6,
                        placeholder="英文优先，减少歧义。例如：a red apple on white background, product photo",
                    )
                    files = gr.Files(
                        label="参考图（可选）—— 拖拽 / 粘贴 / 点击添加，多张则逐张生成",
                        file_types=["image"],
                    )
                # 参数行
                with gr.Row():
                    size = gr.Dropdown(SIZE_OPTIONS, value=SIZE_OPTIONS[0], label="尺寸")
                    quality = gr.Dropdown(["low", "medium", "high"], value="low", label="质量")
                # 输出卡：路径输入 + 选择文件夹 融合
                with gr.Group():
                    with gr.Row(equal_height=True):
                        output_dir = gr.Textbox(
                            label="输出路径", value=DEFAULT_OUTPUT_DIR, scale=4,
                            placeholder="图片保存目录", container=False,
                        )
                        folder_btn = gr.Button("选择文件夹", size="sm", scale=1)
                generate_btn = gr.Button("生成图片", variant="primary", size="lg")
                status = gr.Textbox(label="状态", lines=4, interactive=False)

            # 右侧：结果区（宽屏放大画廊）
            with gr.Column(scale=7, min_width=420):
                gallery = gr.Gallery(label="生成结果", columns=3, height=600)

        folder_btn.click(fn=select_output_folder, inputs=output_dir, outputs=output_dir)
        generate_btn.click(
            fn=generate_and_save,
            inputs=[prompt, files, size, quality, output_dir],
            outputs=[gallery, status],
        )
    return demo


def launch_ui():
    """启动 Gradio 服务并打开浏览器"""
    build_ui().launch(inbrowser=True, theme=themes.Soft(), css=CUSTOM_CSS)


demo = build_ui()

if __name__ == "__main__":
    launch_ui()
