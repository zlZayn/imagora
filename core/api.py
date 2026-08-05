#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生图 API —— 请求封装与生成逻辑

核心函数:
  generate_image()            文生图 / 图生图（主入口）
  resolve_size_with_ratio()   尺寸解析（--size 与 --ratio 二选一）
  build_default_output_path() 默认输出路径（当前目录下 output/）
"""
import base64
import os
import time
from pathlib import Path

import requests

from core.config import BASE_URL, DEFAULT_MODEL, DEFAULT_QUALITY, DEFAULT_SIZE, RATIOS, get_api_key


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
    """输出路径：未指定时落到当前目录下 output/ai_时间戳.后缀"""
    if output_path:
        return output_path
    return str(Path.cwd() / "output" / f"ai_{time.strftime('%Y%m%d_%H%M%S')}.{output_format}")


def generate_image(prompt, image_path, size, quality=DEFAULT_QUALITY,
                   model=DEFAULT_MODEL, n=1, output_format="png", output_path=None):
    """文生图 / 图生图。

    有 image_path 走 edits 接口（底图编辑），否则走 generations 接口。
    成功保存图片到 output_path（默认自动生成）并打印；失败抛异常。

    Args:
        prompt: 提示词（英文优先，减少歧义）
        image_path: 底图路径（None = 文生图）
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

    if image_path:
        # 图生图：底图 + 提示词
        url = f"{BASE_URL}/v1/images/edits"
        with open(image_path, "rb") as f:
            files = {"image": (os.path.basename(image_path), f, "application/octet-stream")}
            response = requests.post(url, headers=headers, files=files, data=payload, timeout=300)
    else:
        # 文生图
        url = f"{BASE_URL}/v1/images/generations"
        response = requests.post(url, headers=headers, json=payload, timeout=300)

    if response.status_code != 200:
        raise RuntimeError(f"请求失败 [{response.status_code}]: {response.text[:500]}")

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
        raise RuntimeError(f"响应里没有图片数据: {str(item)[:300]}")

    print(f"已保存: {output_path} ({len(raw)} bytes)")
