#!/usr/bin/env python3
"""生图 API —— 请求封装与生成逻辑

核心函数:
  generate_image()            文生图 / 图生图（主入口）
  resolve_size_with_ratio()   尺寸解析（--size 与 --ratio 二选一）
  build_default_output_path() 默认输出路径（当前目录下 output/）
"""
import base64
import contextlib
import itertools
import os
import time
from pathlib import Path

import requests

from core.config import (
    API_PATHS,
    BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_QUALITY,
    DEFAULT_SIZE,
    RATIOS,
    get_api_key,
)
from core.console import print_success

# 全局序号：保证默认文件名在并发/多窗口下唯一（时间戳只有秒级，同秒必撞）
_SEQ = itertools.count(1)


def format_error(error: Exception, limit: int = 150) -> str:
    """异常 -> 简短可读文本（类型 + 截断消息），供日志/界面统一展示"""
    return f"{type(error).__name__}: {str(error)[:limit]}"


def resolve_size_with_ratio(size, ratio, tier):
    """--size 与 --ratio 二选一，返回最终分辨率字符串"""
    if ratio and size:
        raise ValueError("--size 和 --ratio 不能同时使用，二选一")
    if ratio:
        if ratio not in RATIOS:
            raise ValueError(f"不支持比例 {ratio}，可用: {', '.join(RATIOS)}")
        tiers = RATIOS[ratio]
        if tier not in tiers:
            raise ValueError(f"比例 {ratio} 没有 {tier} 档，可用档位: {', '.join(tiers)}")
        return tiers[tier]
    return size or DEFAULT_SIZE


def build_default_output_path(output_path, output_format):
    """输出路径：未指定时落到 默认输出目录/output 下 ai_时间戳_序号.后缀（序号保证并发唯一）"""
    if output_path:
        return output_path
    seq = next(_SEQ)
    return str(Path(DEFAULT_OUTPUT_DIR) / f"ai_{time.strftime('%Y%m%d_%H%M%S')}_{seq:03d}.{output_format}")


def generate_image(prompt, image_path=None, images=None, size=DEFAULT_SIZE,
                   quality=DEFAULT_QUALITY, model=DEFAULT_MODEL, n=1,
                   output_format="png", output_path=None):
    """文生图 / 图生图。

    - 传 image_path（单张）或 images（多张参考图）：走 edits 接口
    - 都不传：走 generations 接口（文生图）
    成功保存图片到 output_path（默认自动生成）并打印；失败抛异常。

    Args:
        prompt: 提示词（英文优先，减少歧义）
        image_path: 单张底图路径（None 则看 images）
        images: 多张底图路径列表，一次请求全部作为参考（用途由提示词决定）
        size: 分辨率字符串，如 "1024x1024"
        quality: low / medium / high
        model: 模型名
        n: 生成张数
        output_format: png / jpg / webp
        output_path: 保存路径（None 时自动生成）
    """
    headers = {"Authorization": f"Bearer {get_api_key()}"}
    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": n,
        "output_format": output_format,
    }
    output_path = build_default_output_path(output_path, output_format)

    image_paths = images if images else ([image_path] if image_path else [])
    if image_paths:
        # 图生图：一张或多张参考图，一次请求提交（ExitStack 保证任一打开失败时已开的也关闭）
        url = f"{BASE_URL}{API_PATHS['edits']}"
        with contextlib.ExitStack() as stack:
            opened = [stack.enter_context(open(p, "rb")) for p in image_paths]
            files = [
                ("image", (os.path.basename(p), f, "application/octet-stream"))
                for p, f in zip(image_paths, opened)
            ]
            response = requests.post(url, headers=headers, files=files, data=payload, timeout=300)
    else:
        # 文生图
        url = f"{BASE_URL}{API_PATHS['generations']}"
        response = requests.post(url, headers=headers, json=payload, timeout=300)

    if response.status_code != 200:
        raise RuntimeError(f"接口请求失败（HTTP {response.status_code}）：{response.text[:200]}")

    item = response.json()["data"][0]
    if "b64_json" in item:
        raw = base64.b64decode(item["b64_json"])
        with open(output_path, "wb") as f:
            f.write(raw)
    elif "url" in item:
        raw = requests.get(item["url"], timeout=300).content
        with open(output_path, "wb") as f:
            f.write(raw)
    else:
        raise RuntimeError("接口响应没有图片数据")

    print_success(f"已保存: {output_path}")
