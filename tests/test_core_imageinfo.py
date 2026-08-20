"""core/imageinfo.py 单元测试：图片头解析（宽高/格式），零依赖零网络"""
import struct

from core.imageinfo import image_dimensions


def _png(w=100, h=200):
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0dIHDR"
        + struct.pack(">II", w, h)
        + b"\x08\x06\x00\x00\x00"
        + b"\x00" * 4
    )


def _gif(w=100, h=200):
    return b"GIF89a" + struct.pack("<HH", w, h) + b"\x00" * 20


def _bmp(w=100, h=200):
    return b"BM" + b"\x00" * 8 + b"\x00\x00\x00\x00" + b"\x28\x00\x00\x00" + struct.pack("<ii", w, h) + b"\x00" * 32


def _jpeg(w=100, h=200):
    return (
        b"\xff\xd8"
        + b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        + b"\xff\xc0\x00\x11\x08"
        + struct.pack(">HH", h, w)
        + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00"
        + b"\xff\xd9"
    )


def _webp_vp8(w=100, h=200):
    return (
        b"RIFF\x00\x00\x00\x00WEBP"
        + b"VP8 \x00\x00\x00\x00"
        + b"\x00\x00\x00\x9d\x01\x2a"
        + struct.pack("<H", w) + struct.pack("<H", h)
        + b"\x00" * 8
    )


def _webp_vp8l(w=100, h=200):
    bits = (w - 1) | ((h - 1) << 14)
    return (
        b"RIFF\x00\x00\x00\x00WEBP"
        + b"VP8L\x00\x00\x00\x00"
        + b"\x2f"
        + struct.pack("<I", bits)
        + b"\x00" * 8
    )


def _webp_vp8x(w=100, h=200):
    return (
        b"RIFF\x00\x00\x00\x00WEBP"
        + b"VP8X\x00\x00\x00\x00"
        + b"\x00\x00\x00\x00"
        + (w - 1).to_bytes(3, "little") + (h - 1).to_bytes(3, "little")
        + b"\x00" * 8
    )


def _write(tmp_path, name, data):
    p = tmp_path / name
    p.write_bytes(data)
    return str(p)


def test_png(tmp_path):
    assert image_dimensions(_write(tmp_path, "a.png", _png())) == {"width": 100, "height": 200, "format": "png"}


def test_gif(tmp_path):
    assert image_dimensions(_write(tmp_path, "a.gif", _gif())) == {"width": 100, "height": 200, "format": "gif"}


def test_bmp(tmp_path):
    assert image_dimensions(_write(tmp_path, "a.bmp", _bmp())) == {"width": 100, "height": 200, "format": "bmp"}


def test_jpeg(tmp_path):
    assert image_dimensions(_write(tmp_path, "a.jpg", _jpeg())) == {"width": 100, "height": 200, "format": "jpeg"}


def test_webp_vp8(tmp_path):
    assert image_dimensions(_write(tmp_path, "a.webp", _webp_vp8())) == {"width": 100, "height": 200, "format": "webp"}


def test_webp_vp8l(tmp_path):
    assert image_dimensions(_write(tmp_path, "a.webp", _webp_vp8l())) == {"width": 100, "height": 200, "format": "webp"}


def test_webp_vp8x(tmp_path):
    assert image_dimensions(_write(tmp_path, "a.webp", _webp_vp8x())) == {"width": 100, "height": 200, "format": "webp"}


def test_garbage_returns_none(tmp_path):
    assert image_dimensions(_write(tmp_path, "g.bin", b"not an image at all")) is None


def test_truncated_png_returns_none(tmp_path):
    assert image_dimensions(_write(tmp_path, "t.png", b"\x89PNG\r\n\x1a\n" + b"\x00")) is None


def test_missing_file_returns_none(tmp_path):
    assert image_dimensions(str(tmp_path / "nope.png")) is None