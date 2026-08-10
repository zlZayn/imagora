#!/usr/bin/env python3
"""配置中心 —— 统一管理 API Key、接口地址、尺寸映射与默认参数

API Key 读取优先级:
  1. 环境变量 AIWANWU_API_KEY
  2. tools/.env 文件（AIWANWU_API_KEY=sk-...，自动加载，不覆盖已存在的环境变量）
"""
import os
from pathlib import Path

# ---------- 工作根（启动时固定一次，后续路径统一以此为基准） ----------
WORK_ROOT = Path.cwd()

# ---------- 接口 ----------
BASE_URL = "https://2api.aiwanwu.cc"

# ---------- 默认输出目录（未指定时生成到 工作根/output） ----------
DEFAULT_OUTPUT_DIR = str(WORK_ROOT / "output")

# ---------- API Key ----------
ENV_KEY_NAME = "AIWANWU_API_KEY"
ENV_FILE_PATH = Path(__file__).resolve().parent.parent / ".env"


def _load_env_file():
    """读取 tools/.env（KEY=VALUE，# 注释），已存在的环境变量不覆盖"""
    if not ENV_FILE_PATH.exists():
        return
    for line in ENV_FILE_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_api_key():
    """返回 API Key；未配置时给出明确指引"""
    _load_env_file()
    key = os.environ.get(ENV_KEY_NAME)
    if not key:
        raise RuntimeError(
            f"未设置 {ENV_KEY_NAME}。请先配置，二选一：\n"
            f"  1) 环境变量:  $env:{ENV_KEY_NAME}=\"sk-...\"\n"
            f"  2) 创建文件 {ENV_FILE_PATH} 写入:  {ENV_KEY_NAME}=sk-..."
        )
    return key


# ---------- 尺寸映射（取自上游文档列出的合法尺寸） ----------
# 比例 -> {档位: 分辨率字符串}（CLI 用：--ratio --tier 解析出分辨率）
RATIOS = {
    "1:1":  {"1K": "1024x1024", "2K": "2048x2048"},
    "3:2":  {"2K": "1536x1024"},
    "2:3":  {"2K": "1024x1536"},
    "16:9": {"2K": "2048x1152", "4K": "3840x2160"},
    "9:16": {"2K": "1152x2048", "4K": "2160x3840"},
    "7:4":  {"2K": "1792x1024"},
    "4:7":  {"2K": "1024x1792"},
}

# ---------- UI 尺寸 / 质量选项（/api/config 下发前端下拉，含单张费用） ----------
# 与 RATIOS 是两种消费方式：UI 直选分辨率，CLI 按 比例+档位 解析；改尺寸时两处需同步
SIZE_OPTIONS = [
    {"value": "1024x1024", "label": "1024x1024 (1:1 1K)", "cost": 0.05},
    {"value": "1024x1536", "label": "1024x1536 (2:3 竖版)", "cost": 0.10},
    {"value": "1536x1024", "label": "1536x1024 (3:2 横版)", "cost": 0.10},
    {"value": "1152x2048", "label": "1152x2048 (9:16 竖版长图)", "cost": 0.10},
    {"value": "2048x1152", "label": "2048x1152 (16:9 横版)", "cost": 0.10},
    {"value": "1024x1792", "label": "1024x1792 (竖版长图)", "cost": 0.10},
    {"value": "1792x1024", "label": "1792x1024 (横版长图)", "cost": 0.10},
]
QUALITY_OPTIONS = ["low", "medium", "high"]

# ---------- 默认参数 ----------
DEFAULT_MODEL = "gpt-image-2"
DEFAULT_QUALITY = "high"
DEFAULT_SIZE = "1024x1024"
DEFAULT_TIER = "2K"
