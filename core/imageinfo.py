#!/usr/bin/env python3
"""图片头部解析（纯标准库，零第三方依赖）：从文件头提取宽高与格式。

供注册表 v2 条目的 width/height/format 元数据与迁移工具使用；
无法解析（非图片 / 文件损坏 / 缺读权限）一律返回 None，调用方按可选字段处理。
"""
import struct

# JPEG SOF（帧开始）标记：SOF0-SOF15，排除 DHT(C4)/JPG(C8)/DAC(CC)
_JPEG_SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def _jpeg_dimensions(head: bytes) -> dict | None:
    """JPEG：沿段表扫描到第一个 SOF 段读出宽高（部分图片 SOF 不在头部 64 字节内时返回 None）"""
    pos = 2  # 跳过 SOI (FFD8)
    while pos + 9 <= len(head):
        if head[pos] != 0xFF:
            return None
        marker = head[pos + 1]
        if marker == 0xD8 or 0xD0 <= marker <= 0xD7:  # SOI / RSTn：无长度
            pos += 2
            continue
        if marker in (0x01, 0xD9):  # TEM / EOI
            pos += 2
            continue
        if pos + 4 > len(head):
            return None
        seg_len = struct.unpack(">H", head[pos + 2:pos + 4])[0]
        if seg_len < 2:
            return None
        if marker in _JPEG_SOF_MARKERS and seg_len >= 7:
            height, width = struct.unpack(">HH", head[pos + 5:pos + 9])
            return {"width": width, "height": height, "format": "jpeg"}
        pos += 2 + seg_len
    return None


def _webp_dimensions(head: bytes) -> dict | None:
    """WebP：RIFF/WEBP 容器，按 VP8 / VP8L / VP8X 三种位流分别解析"""
    chunk = head[12:16]
    if chunk == b"VP8 " and len(head) >= 30:  # 有损：帧头后 2 字节宽 + 2 字节高（14 位有效）
        width = struct.unpack("<H", head[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", head[28:30])[0] & 0x3FFF
        return {"width": width, "height": height, "format": "webp"}
    if chunk == b"VP8L" and len(head) >= 25:  # 无损：签名 0x2F 后 4 字节内各 14 位宽高（均 -1）
        bits = struct.unpack("<I", head[21:25])[0]
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return {"width": width, "height": height, "format": "webp"}
    if chunk == b"VP8X" and len(head) >= 30:  # 扩展：24 位宽高（均 -1）
        width = int.from_bytes(head[24:27], "little") + 1
        height = int.from_bytes(head[27:30], "little") + 1
        return {"width": width, "height": height, "format": "webp"}
    return None


def image_dimensions(path: str) -> dict | None:
    """返回 {width, height, format}（format 为小写扩展名）；无法解析返回 None。

    只读文件头 64 字节，零依赖、廉价；所有解析失败路径都收敛到 None（不抛异常）。
    """
    try:
        with open(path, "rb") as f:
            head = f.read(64)
    except OSError:
        return None
    if head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 24:
        width, height = struct.unpack(">II", head[16:24])
        return {"width": width, "height": height, "format": "png"}
    if head.startswith(b"\xff\xd8"):
        return _jpeg_dimensions(head)
    if head.startswith((b"GIF87a", b"GIF89a")):
        width, height = struct.unpack("<HH", head[6:10])
        return {"width": width, "height": height, "format": "gif"}
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return _webp_dimensions(head)
    if head.startswith(b"BM") and len(head) >= 26:
        width, height = struct.unpack("<ii", head[18:26])
        return {"width": width, "height": height, "format": "bmp"}
    return None