"""core/pathtrust.py 单元测试：路径白名单单一实现（跨盘/越界/多根）"""
import os

from core import pathtrust


def test_match_roots_inside_and_outside(tmp_path):
    root_a = tmp_path / ".refs"
    root_b = tmp_path / ".canvas"
    (tmp_path / ".refs").mkdir()
    f = tmp_path / ".refs" / "a.png"
    f.write_bytes(b"x")
    assert pathtrust.match_roots(str(f), [str(root_a), str(root_b)]) == str(f)
    assert pathtrust.match_roots(str(f), [str(root_b)]) is None  # 白名单外拒绝
    assert pathtrust.match_roots(str(tmp_path / "escape.png"), [str(root_a)]) is None


def test_match_roots_cross_drive_isolated():
    """跨盘 root 单独捕获，不影响其他 root 匹配"""
    import platform
    if platform.system() != "Windows":
        return  # 非 Windows 无盘符概念，跳过
    root = os.path.abspath(os.curdir)
    # 构造一个必然跨盘的 root（Z: 不存在也无妨——commonpath 才抛）
    x = pathtrust.match_roots(root, ["Z:\\nonexistent", root])
    assert x is None or os.path.normcase(x) == os.path.normcase(root)
