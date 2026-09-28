#!/usr/bin/env python3
"""core/config.py 单元测试

覆盖: get_api_key（环境变量 / 跟随 profile / 缺失报错）、profile 解析（纯函数）、RATIOS 表结构合法性、
配置来源视图 build_profile_view（值 + 来自哪一层，供 /api/config 下发前端呈现）。
"""

import re

import pytest

import core.config as config


def test_get_api_key_from_env(monkeypatch, tmp_path):
    """环境变量已设置 -> 直接返回"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.setattr(config, "ACTIVE_PROFILE", "wanwu")
    monkeypatch.delenv("API_KEY_WANWU", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.setenv(config.ENV_KEY_NAME, "sk-test")
    assert config.get_api_key() == "sk-test"


def test_get_api_key_missing_raises(monkeypatch, tmp_path):
    """未设置任何来源 -> 抛清晰错误"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.setattr(config, "ACTIVE_PROFILE", "wanwu")
    monkeypatch.delenv("API_KEY_WANWU", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.delenv(config.ENV_KEY_NAME, raising=False)
    with pytest.raises(RuntimeError, match="AIWANWU_API_KEY"):
        config.get_api_key()


def test_ratios_all_values_are_valid_size_format():
    """RATIOS 表里所有分辨率都是合法的 宽x高 格式"""
    size_pattern = re.compile(r"^\d+x\d+$")
    for ratio, tiers in config.RATIOS.items():
        assert re.fullmatch(r"^\d+:\d+$", ratio), f"比例格式非法: {ratio}"
        for tier, size in tiers.items():
            assert size_pattern.match(size), f"{ratio}/{tier} 分辨率非法: {size}"
            assert tier in {"1K", "2K", "4K"}, f"档位非法: {tier}"


def test_default_quality_is_high():
    """所有未显式指定质量的入口统一使用 high。"""
    assert config.DEFAULT_QUALITY == "high"


def test_resolve_profile_prefers_env_active():
    """env 的 ACTIVE_PROFILE 优先于 config.json 的 default_profile"""
    cfg = {
        "default_profile": "wanwu",
        "profiles": {"wanwu": {"base_url": "a"}, "other": {"base_url": "b"}},
    }
    name, profile = config.resolve_profile_config(cfg, "other")
    assert name == "other"
    assert profile["base_url"] == "b"


def test_resolve_profile_falls_back_to_default():
    """未指定 env 时使用 config.json 的 default_profile"""
    cfg = {"default_profile": "wanwu", "profiles": {"wanwu": {"base_url": "a"}}}
    name, profile = config.resolve_profile_config(cfg, None)
    assert name == "wanwu"
    assert profile["base_url"] == "a"


def test_resolve_profile_missing_profile_returns_empty():
    """指定的 profile 不存在 -> 返回 (名, {})，由调用方回退内置默认"""
    cfg = {"default_profile": "wanwu", "profiles": {"wanwu": {}}}
    name, profile = config.resolve_profile_config(cfg, "nope")
    assert name == "nope"
    assert profile == {}


def test_resolve_profile_empty_config_returns_none():
    """config.json 缺失/为空 -> (None, {})，全部走内置默认"""
    assert config.resolve_profile_config({}, None) == (None, {})


def test_resolve_profile_no_profiles_key_warns():
    """有 default_profile 但没有 profiles 对象 -> 警告并回退"""
    with pytest.warns(UserWarning):
        _, profile = config.resolve_profile_config({"default_profile": "wanwu"}, None)
    assert profile == {}


def test_unknown_profile_keys_detects_typos():
    """白名单校验：拼错的键会被识别，防止静默失效"""
    profile = {"base_url": "https://x", "base_ur": "https://typo"}
    assert config.unknown_profile_keys(profile) == ["base_ur"]
    assert config.unknown_profile_keys({"base_url": "https://x"}) == []


def test_get_api_key_follows_active_profile(monkeypatch, tmp_path):
    """ACTIVE_PROFILE=other 时优先读 API_KEY_OTHER"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.setattr(config, "ACTIVE_PROFILE", "other")
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.delenv(config.ENV_KEY_NAME, raising=False)
    monkeypatch.setenv("API_KEY_OTHER", "sk-other")
    assert config.get_api_key() == "sk-other"


def test_get_api_key_generic_fallback(monkeypatch, tmp_path):
    """profile 专属 key 缺失时回退通用 API_KEY"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.setattr(config, "ACTIVE_PROFILE", "wanwu")
    monkeypatch.delenv("API_KEY_WANWU", raising=False)
    monkeypatch.delenv(config.ENV_KEY_NAME, raising=False)
    monkeypatch.setenv("API_KEY", "sk-generic")
    assert config.get_api_key() == "sk-generic"


def test_get_api_key_legacy_name_still_works(monkeypatch, tmp_path):
    """旧写法 AIWANWU_API_KEY 仍生效（老用户零改动）"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.setattr(config, "ACTIVE_PROFILE", "wanwu")
    monkeypatch.delenv("API_KEY_WANWU", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.setenv(config.ENV_KEY_NAME, "sk-legacy")
    assert config.get_api_key() == "sk-legacy"


def test_missing_key_message_lists_candidates(monkeypatch, tmp_path):
    """缺失报错信息列出全部候选键名（含 profile 专属键），指引清晰"""
    monkeypatch.setattr(config, "ENV_FILE_PATH", tmp_path / "no.env")
    monkeypatch.setattr(config, "ACTIVE_PROFILE", "wanwu")
    monkeypatch.delenv("API_KEY_WANWU", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.delenv(config.ENV_KEY_NAME, raising=False)
    with pytest.raises(RuntimeError) as exc:
        config.get_api_key()
    msg = str(exc.value)
    assert "API_KEY_WANWU" in msg and "AIWANWU_API_KEY" in msg


def test_cost_for_size_from_size_options():
    """计费唯一来自 size_options：已知档命中，未知档 0.0（不硬编码兜底价）"""
    known = config.SIZE_OPTIONS[0]
    assert config.cost_for_size(known["value"]) == float(known["cost"])
    assert config.cost_for_size("9999x9999") == 0.0


def test_build_profile_view_reports_layer_sources():
    """配置视图：每个值都带「来自哪一层」——profile 写死的标 config.json，回退的标内置默认；
    本机注册的 profile 名一并列出（前端据此展示，不必自己读 config.json）。"""
    cfg = {
        "default_profile": "wanwu",
        "profiles": {"wanwu": {"base_url": "https://a.example"}, "other": {}},
    }
    view = config.build_profile_view(
        profile_name="wanwu",
        profile={"base_url": "https://a.example"},
        cfg=cfg,
        env_active="",
        env_file_keys=set(),
        api_key_name=None,
    )
    assert view["name"] == "wanwu"
    assert view["nameSource"] == "config.json default_profile"
    assert view["registeredProfiles"] == ["other", "wanwu"]

    by_key = {field["key"]: field for field in view["fields"]}
    assert by_key["baseUrl"]["value"] == "https://a.example"
    assert by_key["baseUrl"]["source"] == "config.json profile"
    # profile 没写的字段回退内置兜底，来源要如实标注（前端由此提示「你没配，这是默认值」）
    assert by_key["model"]["source"] == "内置默认"
    assert by_key["model"]["value"]


def test_build_profile_view_marks_env_and_key_source():
    """来源标注要区分 .env 与系统环境变量；密钥只报「已配置 + 来源」，绝不回传值本身。"""
    view = config.build_profile_view(
        profile_name="wanwu",
        profile={},
        cfg={},
        env_active="other",
        env_file_keys={"ACTIVE_PROFILE", "API_KEY_OTHER"},
        api_key_name="API_KEY_OTHER",
    )
    assert view["nameSource"] == ".env ACTIVE_PROFILE"
    assert view["registeredProfiles"] == []
    key_field = {field["key"]: field for field in view["fields"]}["apiKey"]
    assert key_field["configured"] is True
    assert key_field["source"] == ".env API_KEY_OTHER"
    assert key_field["value"] is None

    # 系统环境变量（非 .env 文件）用另一种措辞，两种来源不该混为一谈
    view2 = config.build_profile_view(
        profile_name="wanwu",
        profile={},
        cfg={},
        env_active="",
        env_file_keys=set(),
        api_key_name="API_KEY",
    )
    assert {field["key"]: field for field in view2["fields"]}["apiKey"]["source"] == (
        "环境变量 API_KEY"
    )
