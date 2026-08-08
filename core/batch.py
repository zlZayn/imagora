#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量生图编排 —— 读项目目录下的 batch_prompts.json 逐张调用

路径基准 = 配置文件所在目录（assets/、output/ 均相对配置）。
CLI 入口在 main.py（python main.py batch --config <项目>/batch_prompts.json）。
"""
import json
import os
import time
from pathlib import Path

from core.api import format_error, generate_image
from core.logging import log_generation


def load_batch_config(config_path):
    """读取批量配置文件（JSON）"""
    with open(config_path, encoding="utf-8") as f:
        return json.load(f)


def resolve_base_image_paths(config_dir, base_images):
    """把配置里的相对路径解析为绝对路径，基准 = 配置文件所在目录"""
    resolved = {}
    for key, path in (base_images or {}).items():
        resolved[key] = str(config_dir / path) if not os.path.isabs(path) else path
    return resolved


def filter_jobs_by_module(jobs, module_filter):
    """按模块号过滤任务（如 "2,5" -> 模块 2 和 5）"""
    if not module_filter:
        return jobs
    wanted = set(module_filter.split(","))
    return [j for j in jobs if j["module"].split("_")[0] in wanted]


def run_batch_generation(config_path, module_filter=None, dry_run=False):
    """执行批量生图。dry_run 只预览配置与成本，不调用 API。返回失败 id 列表。

    Args:
        config_path: 项目目录下的 batch_prompts.json 路径
        module_filter: 只跑指定模块号（逗号分隔），None = 全部
        dry_run: True 时只预览，不调用 API
    """
    config_path = Path(config_path)
    config_dir = config_path.parent
    config = load_batch_config(config_path)
    jobs = filter_jobs_by_module(config["jobs"], module_filter)
    base_images = resolve_base_image_paths(config_dir, config.get("base_images", {}))

    tier_cost = config.get("tier_cost", 0.10)
    print(f"共 {len(jobs)} 张，档位 {config['size']}（单张 {tier_cost} 元）")
    print(f"预估总成本: {len(jobs) * tier_cost:.2f} 元\n")
    for job in jobs:
        img = job["image"]
        image_desc = base_images.get(img, img) if img else "文生图"
        print(f"[{job['id']}] {job['module']}/{job['name']}  底图: {image_desc}")

    if dry_run:
        print("\n[DRY-RUN] 未调用 API")
        return []

    output_root = str(config_dir / config["out_dir"])
    failed = []
    for job in jobs:
        image_path = base_images.get(job["image"]) if job["image"] else None
        module_dir = os.path.join(output_root, job["module"])
        os.makedirs(module_dir, exist_ok=True)
        output_path = os.path.join(module_dir, f"{job['id']}_{job['name']}.png")

        print(f"\n生成中 [{job['id']}] {job['name']} …", flush=True)
        job_started_at = time.time()
        try:
            generate_image(
                prompt=job["prompt"],
                image_path=image_path,
                size=config["size"],
                quality="low",
                output_format="png",
                output_path=output_path,
            )
            job_ok = True
        except Exception as e:
            print(f"[{job['id']}] 失败: {format_error(e, 200)}")
            failed.append(job["id"])
            job_ok = False
        log_generation(
            prompt=job["prompt"],
            mode="img2img" if image_path else "txt2img",
            refs=1 if image_path else 0,
            size=config["size"],
            quality="low",
            status="ok" if job_ok else "error",
            output=output_path if job_ok else "",
            cost=config.get("tier_cost", 0.10) if job_ok else 0.0,
            seconds=time.time() - job_started_at,
        )
        time.sleep(5)  # 防限流

    print("\n=== 完成 ===")
    if failed:
        print("失败清单（可重跑）:", ", ".join(failed))
    else:
        print("全部成功，输出目录:", output_root)
    return failed
