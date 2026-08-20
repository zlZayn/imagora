"""共享测试夹具：统一隔离输出目录（registry / graphstore / canvas shim 三处常量一并注入 tmp_path）。"""
import pytest
from core import canvas, graphstore, registry


@pytest.fixture
def asset_iso(tmp_path, monkeypatch):
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
    return tmp_path
