#!/usr/bin/env python3
"""Seedream 接入自检 —— 定位「豆包 Seedream 生成不了」的根因。

用法（在 imagora 目录下）:
    python scripts/seedream_selftest.py                      # 用 .env 里的 Key
    python scripts/seedream_selftest.py --key ark-xxxx       # 临时指定 Key
    python scripts/seedream_selftest.py --key ark-xxxx --base https://2api.aiwanwu.cc

它做 4 件事：
  1. 打印当前生效的 base_url / 接口路径 / Key 来源（脱敏）
  2. GET /v1/models，把中转站实际注册的模型名列出来（找 seedream 的正确写法）
  3. 用候选模型名逐个 POST /v1/images/generations，打印完整原始响应
     （无论成功失败都打印，方便看清是「模型名错」还是「响应格式不兼容」）
  4. 判定每条被拒的真实原因（HTTP 状态 + 响应体原文）

结论会直接告诉你：模型名对不对 / 是同步还是异步 / 返回字段叫什么。
"""

import argparse
import json
import sys
from pathlib import Path

import requests

# 让脚本能 import core.*（在 imagora 根目录运行时）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 候选模型名：覆盖火山方舟官方 ID 与中转站常见简写，逐个试探
CANDIDATE_MODELS = [
    "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5-0-pro",
    "doubao-seedream-4-0-250828",
    "doubao-seedream-4-0",
    "doubao-seedream-3-0-t2i-250415",
    "seedream-5-0-pro",
    "seedream-4.0",
    "seedream-3.0",
]

PROMPT = "a red apple on a white background, product photo"


def mask(key: str) -> str:
    if not key:
        return "(空)"
    return f"{key[:8]}...{key[-4:]}（len={len(key)}）" if len(key) > 14 else "***"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", default=None, help="临时指定 API Key（优先于 .env）")
    ap.add_argument("--base", default=None, help="中转站 base url，默认取 config.json")
    args = ap.parse_args()

    try:
        from core.config import ACTIVE_PROFILE, API_PATHS, BASE_URL
    except Exception as e:
        print(f"[!] 读取 config 失败: {e}")
        BASE_URL, API_PATHS, ACTIVE_PROFILE = (
            "https://2api.aiwanwu.cc",
            {"generations": "/v1/images/generations"},
            "?",
        )

    base = (args.base or BASE_URL).rstrip("/")
    gen_path = API_PATHS.get("generations", "/v1/images/generations")

    print("=" * 68)
    print("Seedream 接入自检")
    print("=" * 68)
    print(f"profile      : {ACTIVE_PROFILE}")
    print(f"base_url     : {base}")
    print(f"generations  : {gen_path}")

    if args.key:
        key = args.key.strip()
        print(f"api_key      : {mask(key)}（来自 --key 参数）")
    else:
        try:
            from core.config import get_api_key, get_api_key_source

            key = get_api_key()
            print(f"api_key      : {mask(key)}（来自 {get_api_key_source()}）")
        except Exception as e:
            print(f"api_key      : 读取失败 → {e}")
            key = ""

    if not key:
        print("\n[✗] 没有拿到 API Key，后续请求必然失败。请先填 .env 或用 --key 传入。")
        return 2

    headers = {"Authorization": f"Bearer {key}"}

    # ---------- 1. 列出可用模型 ----------
    print("\n" + "-" * 68)
    print("[1/2] 拉取可用模型列表")
    print("-" * 68)
    # 火山方舟模型列表在 /api/v3/models；OpenAI 兼容中转站在 /v1/models
    if "/api/v3" in base:
        models_url = f"{base}/models"
    else:
        models_url = f"{base}/v1/models"
    print(f"GET {models_url}")
    try:
        r = requests.get(models_url, headers=headers, timeout=30)
        print(f"HTTP {r.status_code}")
        if r.status_code == 200:
            try:
                data = r.json().get("data", [])
                ids = [m.get("id") for m in data if isinstance(m, dict)]
                print(f"共 {len(ids)} 个模型")
                hits = [
                    i
                    for i in ids
                    if i and ("seed" in i.lower() or "doubao" in i.lower())
                ]
                if hits:
                    print("\n>>> 与 Seedream/豆包 相关的模型：")
                    for h in hits:
                        print(f"      {h}")
                else:
                    print("\n>>> 列表里没找到 seedream/doubao 相关模型")
                    print("    前 30 个模型：")
                    for i in ids[:30]:
                        print(f"      {i}")
            except Exception as e:
                print(f"解析失败: {e}\n原始: {r.text[:500]}")
        else:
            print(f"响应: {r.text[:500]}")
    except Exception as e:
        print(f"请求异常: {type(e).__name__}: {e}")

    # ---------- 2. 逐个模型名试探生成 ----------
    print("\n" + "-" * 68)
    print("[2/2] 逐个模型名试探  POST " + gen_path)
    print("-" * 68)
    url = f"{base}{gen_path}"
    for model in CANDIDATE_MODELS:
        body = {"model": model, "prompt": PROMPT, "size": "1024x1024"}
        print(f"\n▶ model = {model}")
        try:
            r = requests.post(url, headers=headers, json=body, timeout=120)
            print(f"  HTTP {r.status_code}  ({len(r.content)} bytes)")
            text = r.text
            try:
                parsed = r.json()
                # 只打印结构骨架，避免巨量 base64 刷屏
                if (
                    "data" in parsed
                    and isinstance(parsed["data"], list)
                    and parsed["data"]
                ):
                    item = parsed["data"][0]
                    keys = (
                        list(item.keys())
                        if isinstance(item, dict)
                        else type(item).__name__
                    )
                    print(f"  ✓ 返回 data[0] 字段: {keys}")
                    b64 = item.get("b64_json") if isinstance(item, dict) else None
                    b64len = len(b64) if isinstance(b64, str) else 0
                    print(
                        f"    b64_json 长度: {b64len} | url: {item.get('url') if isinstance(item, dict) else None}"
                    )
                    if b64len > 1000 or (isinstance(item, dict) and item.get("url")):
                        print("    ★ 这个模型名可用，且是 OpenAI 兼容格式")
                        print(f"\n结论：把模型名改成「{model}」即可。")
                        return 0
                else:
                    print(
                        f"  完整响应(截断): {json.dumps(parsed, ensure_ascii=False)[:600]}"
                    )
            except Exception:
                print(f"  (非 JSON 响应) {text[:600]}")
        except Exception as e:
            print(f"  请求异常: {type(e).__name__}: {e}")

    print("\n" + "=" * 68)
    print("以上模型名均未成功。请把上面任意一条的「完整响应」原样发出来，")
    print("重点看：HTTP 状态码 / 是否提示模型名不存在 / 返回字段叫什么。")
    print("=" * 68)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
