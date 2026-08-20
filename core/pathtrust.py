#!/usr/bin/env python3
"""路径信任（白名单）校验 —— 跨模块共享的单一实现。

供 core/canvas（.refs/.canvas 双根）与 server（.refs 单根）统一调用，
避免两处各写一套 commonpath 校验（此前 safe_ref_path_allowlist 与
server.safe_ref_path 就是两份近似重复）。
"""
import os


def match_roots(path: str, roots: list[str]) -> str | None:
    """abs path 与任一 root 的 commonpath 匹配则返回 abs，否则 None。

    注意：commonpath 在跨盘（不同盘符）时抛 ValueError，需逐 root 单独捕获——
    某个 root 跨盘不代表其他 root 不匹配。
    """
    abs_path = os.path.abspath(path)
    for root in roots:
        try:
            root_abs = os.path.abspath(root)
            if os.path.commonpath([abs_path, root_abs]) == root_abs:
                return abs_path
        except ValueError:
            continue
    return None
