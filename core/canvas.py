#!/usr/bin/env python3
"""兼容 shim：资产注册表与图/工作流存储已拆分为 core.registry + core.graphstore。
本文件保留由旧模块名（from core import canvas）调用，星号导出两模块全部公开符号。
"""
from core.registry import *
from core.graphstore import *
# 星号导入不暴露私有名，补显式导出 migrate 等仍通过旧模块名引用的私有符号
from core.registry import _REGISTRY_LOCK

