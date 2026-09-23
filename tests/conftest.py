"""共享测试夹具：统一隔离用户数据目录（输出目录 / 注册表 / 工作流 / 账本 / 预算）。

**默认隔离（autouse）**：`isolate_user_data` 对所有用例生效——历史上 `asset_iso` 是 opt-in，
漏用的用例会把测试图片写进真实 `output/.assets`、把预算写进真实 `output/.budget.json`
（已实测复现：跑一次 pytest 就多出 `canv_*` 假资产）。测试绝不允许碰用户真实数据。
"""
import sys

import pytest

from core import canvas, cost, graphstore, history, registry


def _patch_user_data_paths(tmp_path, monkeypatch) -> None:
    """把"用户数据"相关模块常量整体指向 tmp_path（单点实现，autouse 与显式夹具共用）。"""
    t = str(tmp_path)
    for mod in (registry, graphstore, canvas):
        monkeypatch.setattr(mod, 'DEFAULT_OUTPUT_DIR', t, raising=False)
    for mod in (registry, canvas):
        monkeypatch.setattr(mod, 'ASSET_DIR', str(tmp_path / '.canvas'))
        monkeypatch.setattr(mod, 'REGISTRY_FILE', str(tmp_path / '.canvas' / 'registry.json'))
        monkeypatch.setattr(mod, 'LEGACY_ASSET_DIR', str(tmp_path / '.canvas'), raising=False)
    for mod in (graphstore, canvas):
        monkeypatch.setattr(mod, 'WORKFLOWS_DIR', str(tmp_path / 'workflows'))
        monkeypatch.setattr(mod, 'RECOVERY_DIR', str(tmp_path / 'workflows' / '.recovery'), raising=False)
        monkeypatch.setattr(mod, 'SUBMISSIONS_DIR', str(tmp_path / 'submissions'), raising=False)
    # 账本（生成历史 JSONL）与预算设置：读要走 tmp，写更不能落到用户目录
    monkeypatch.setattr(history, 'HISTORY_FILE', tmp_path / 'generation.jsonl')
    monkeypatch.setattr(cost, 'BUDGET_FILE', str(tmp_path / '.budget.json'))
    # server 的派生常量（import 时由 DEFAULT_OUTPUT_DIR 算出）：仅在已导入时补丁
    srv = sys.modules.get('server')
    if srv is not None:
        monkeypatch.setattr(srv, 'REF_DIR', str(tmp_path / '.refs'), raising=False)
        monkeypatch.setattr(srv, 'LAST_OUTPUT_DIR_FILE', str(tmp_path / '.last_output_dir'), raising=False)


@pytest.fixture(autouse=True)
def isolate_user_data(tmp_path, monkeypatch):
    """自动隔离（无需声明）：输出目录 / 注册表 / 工作流 / 账本 / 预算全部落 tmp_path。"""
    _patch_user_data_paths(tmp_path, monkeypatch)
    return tmp_path


@pytest.fixture
def asset_iso(isolate_user_data):
    """显式声明版（既有用例沿用）：与 autouse 的 isolate_user_data 同一实现。"""
    return isolate_user_data


@pytest.fixture
def cost_iso(isolate_user_data):
    """成本/账本隔离（语义化命名，供成本与预算用例显式声明；实现同 autouse）。"""
    return isolate_user_data
