#!/usr/bin/env python3
"""配置中心 —— 统一管理 API Key、接口地址、尺寸映射与默认参数

配置分层（优先级从高到低）:
  1. 环境变量（含 .env 自动加载，已存在的环境变量不被覆盖）
  2. config.json 的 profiles[ACTIVE_PROFILE]（用户可编辑，换中转站/模型/尺寸改这里）
  3. config.json 的 default_profile（未显式指定时的公共默认，git 跟踪）
  4. 内置默认值（config.json 缺失 / profile 缺失 / 字段缺失时 fallback）

API Key 读取优先级（跟随 ACTIVE_PROFILE 自动切换中转站）:
  1. API_KEY_<PROFILE 大写>（如 API_KEY_WANWU）—— 每套中转站配自己的 key
  2. API_KEY（通用回退）
  3. AIWANWU_API_KEY（旧写法兼容，老用户零改动）

铁律：密钥只允许出现在 .env / 环境变量；config.json 是公开配置（git 跟踪），绝不放密钥。
"""
import json
import os
import sys
import warnings
from pathlib import Path

# ---------- 工作根（启动时固定一次，后续路径统一以此为基准） ----------
WORK_ROOT = Path.cwd()

# ---------- 内置默认值（兜底，profile 未覆盖的字段回退到这里） ----------
_DEFAULTS = {
    "base_url": "https://2api.aiwanwu.cc",
    "api_paths": {
        "generations": "/v1/images/generations",
        "edits": "/v1/images/edits",
    },
    "ratios": {
        "1:1":  {"1K": "1024x1024", "2K": "2048x2048"},
        "3:2":  {"2K": "1536x1024"},
        "2:3":  {"2K": "1024x1536"},
        "16:9": {"2K": "2048x1152", "4K": "3840x2160"},
        "9:16": {"2K": "1152x2048", "4K": "2160x3840"},
        "7:4":  {"2K": "1792x1024"},
        "4:7":  {"2K": "1024x1792"},
    },
    "size_options": [
        {"value": "1024x1024", "label": "1024x1024 (1:1 1K)", "cost": 0.05},
        {"value": "1024x1536", "label": "1024x1536 (2:3 竖版)", "cost": 0.10},
        {"value": "1536x1024", "label": "1536x1024 (3:2 横版)", "cost": 0.10},
        {"value": "1152x2048", "label": "1152x2048 (9:16 竖版长图)", "cost": 0.10},
        {"value": "2048x1152", "label": "2048x1152 (16:9 横版)", "cost": 0.10},
        {"value": "1024x1792", "label": "1024x1792 (竖版长图)", "cost": 0.10},
        {"value": "1792x1024", "label": "1792x1024 (横版长图)", "cost": 0.10},
    ],
    "quality_options": ["low", "medium", "high"],
    "default_model": "gpt-image-2",
    "default_quality": "high",
    "default_size": "1024x1024",
    "default_tier": "2K",
}

# profile 允许的键（白名单：未知键打警告，防 typo 静默失效）
_PROFILE_KEYS = frozenset(_DEFAULTS.keys())

# ---------- config.json 加载 ----------
_CONFIG_FILE = WORK_ROOT / "config.json"


def _load_config_file() -> dict:
    """读取 config.json；文件不存在或格式错误返回空 dict"""
    if not _CONFIG_FILE.exists():
        return {}
    try:
        data = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
        warnings.warn(f"config.json 格式错误（期望 object，实际 {type(data).__name__}），使用默认值")
    except (json.JSONDecodeError, OSError) as e:
        warnings.warn(f"config.json 读取失败：{e}，使用默认值")
    return {}


_cfg = _load_config_file()


def resolve_profile_config(
    cfg: dict, env_active: str | None
) -> tuple[str | None, dict]:
    """纯函数：解析当前生效的 profile。

    返回 (profile 名, profile 配置 dict)：
    - env_active（.env 的 ACTIVE_PROFILE 或环境变量）优先；
    - 否则取 cfg["default_profile"]（git 跟踪的公共默认）；
    - profile 不存在 / 结构错误 → 警告并返回 (名, {})，由调用方回退内置默认。
    """
    name = (env_active or "").strip() or (cfg.get("default_profile") or "")
    if not name:
        return None, {}
    profiles = cfg.get("profiles")
    if not isinstance(profiles, dict):
        warnings.warn("config.json 缺少 profiles 对象，使用内置默认值")
        return name, {}
    profile = profiles.get(name)
    if not isinstance(profile, dict):
        warnings.warn(f"config.json 中找不到 profile「{name}」，使用内置默认值")
        return name, {}
    return name, profile


def unknown_profile_keys(profile: dict) -> list[str]:
    """纯函数：返回 profile 中不在白名单内的键（防 typo 静默失效）"""
    return [k for k in profile if k not in _PROFILE_KEYS]


# ---------- .env 加载（密钥与本地覆盖；不覆盖已存在的环境变量） ----------
_APP_ROOT = Path(os.environ.get("IMAGORA_APP_ROOT", Path.cwd()))
if getattr(sys, "frozen", False):
    _APP_ROOT = Path(sys.executable).resolve().parent
ENV_FILE_PATH = _APP_ROOT / ".env"


def _load_env_file():
    """读取 .env（KEY=VALUE，# 注释），已存在的环境变量不覆盖"""
    if not ENV_FILE_PATH.exists():
        return
    for line in ENV_FILE_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()
ACTIVE_PROFILE, _profile = resolve_profile_config(
    _cfg, os.environ.get("ACTIVE_PROFILE")
)
for _k in unknown_profile_keys(_profile):
    _available = ", ".join(sorted(_PROFILE_KEYS))
    warnings.warn(
        f"profile「{ACTIVE_PROFILE}」包含未知配置键「{_k}」，已忽略"
        f"（可用键：{_available}）"
    )


def _get(key: str):
    """取当前 profile 的配置项，缺失回退内置默认"""
    return _profile.get(key, _DEFAULTS[key])


# ---------- 接口 ----------
BASE_URL = _get("base_url")
API_PATHS = _get("api_paths")

# ---------- 默认输出目录（未指定时生成到 工作根/output；工作根与 profile 无关，不进配置） ----------
DEFAULT_OUTPUT_DIR = str(WORK_ROOT / "output")

# ---------- API Key（跟随 ACTIVE_PROFILE 自动切换中转站） ----------
ENV_KEY_NAME = "AIWANWU_API_KEY"


def get_api_key():
    """返回当前 profile 对应的 API Key；未配置时给出明确指引。

    优先级：API_KEY_<PROFILE 大写> > API_KEY > AIWANWU_API_KEY（旧写法兼容）。
    """
    _load_env_file()
    candidates = []
    if ACTIVE_PROFILE:
        candidates.append(f"API_KEY_{ACTIVE_PROFILE.upper()}")
    candidates += ["API_KEY", "AIWANWU_API_KEY"]
    for name in candidates:
        key = os.environ.get(name)
        if key:
            return key
    raise RuntimeError(
        "未设置 API Key。请配置（任选其一）：\n"
        + "\n".join(f"  {name}=sk-..." for name in candidates)
        + f"\n写入 {ENV_FILE_PATH} 或设置环境变量"
    )


# ---------- 尺寸映射 / UI 选项 / 默认参数（全部来自当前 profile） ----------
RATIOS = _get("ratios")
SIZE_OPTIONS = _get("size_options")
QUALITY_OPTIONS = _get("quality_options")
DEFAULT_MODEL = _get("default_model")
DEFAULT_QUALITY = _get("default_quality")
DEFAULT_SIZE = _get("default_size")
DEFAULT_TIER = _get("default_tier")