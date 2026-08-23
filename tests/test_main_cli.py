"""main.py CLI 全量功能测试：参数校验 / 输出解析 / gen 子命令端到端 / config 子命令。

覆盖 CLI 与 web 表单对等的关键路径：
  - _validate_gen_args：所有必填参数缺失/冲突/越界立即退出
  - _resolve_output：目录/文件/格式后缀三种解析
  - handle_gen_command：mock generate_image，校验资产旁路 + 提交快照 + 全量账本
  - handle_config_command：从 config.json 实时读取并打印当前 profile 的尺寸/比例/质量
  - build_argument_parser：gen / config 子命令挂接
"""
import argparse
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main
from core import logging as log_module


# ---------- 共享夹具 ----------

@pytest.fixture
def gen_env(asset_iso, monkeypatch, tmp_path):
    """统一隔离：资产/工作流/提交/日志目录全部指向 tmp_path，generate_image 替身无网络。

    - 复用 conftest.asset_iso 隔离 registry / graphstore / canvas 三处常量
    - 把 logging.LOGS_DIR 也指到 tmp_path/logs，便于读回账本断言
    - 把 main.generate_image 替换为写假 PNG 的桩，避免真实网络调用
    """
    monkeypatch.setattr(log_module, "LOGS_DIR", tmp_path / "logs")
    monkeypatch.setattr(main, "generate_image", _fake_generate_image)
    return tmp_path


def _fake_generate_image(prompt, image_path=None, images=None, size="1024x1024",
                         quality="low", model="gpt-image-2", n=1,
                         output_format="png", output_path=None):
    """generate_image 桩：写一段假 PNG 字节到 output_path，模拟成功落盘。"""
    if output_path is None:
        raise RuntimeError("test must always pass output_path explicitly")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(b"\x89PNG-fake")
    return output_path


def _ns_gen(**overrides):
    """构造一个最小可用的 gen 命名空间，单测覆盖单点改动。"""
    ns = argparse.Namespace(
        prompt="a test prompt",
        image=None,
        output="out.png",
        size="1024x1024",
        ratio=None,
        tier="2K",
        quality="high",
        model="gpt-image-2",
        n=1,
        format="png",
        no_asset=False,
    )
    ns.__dict__.update(overrides)
    return ns


# ---------- _validate_gen_args ----------

class TestValidateGenArgs:
    def test_missing_size_and_ratio_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(size=None, ratio=None))
        assert exc.value.code == 2

    def test_missing_quality_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(quality=None))
        assert exc.value.code == 2

    def test_missing_output_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(output=None))
        assert exc.value.code == 2

    def test_size_and_ratio_conflict_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(size="1024x1024", ratio="9:16"))
        assert exc.value.code == 2

    def test_invalid_ratio_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(size=None, ratio="bad:ratio"))
        assert exc.value.code == 2

    def test_invalid_tier_for_ratio_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(size=None, ratio="9:16", tier="999K"))
        assert exc.value.code == 2

    def test_invalid_quality_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(quality="ultra"))
        assert exc.value.code == 2

    def test_invalid_size_exits(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main._validate_gen_args(_ns_gen(size="999x999"))
        assert exc.value.code == 2

    def test_valid_size_passes(self, gen_env):
        # 不抛即通过
        main._validate_gen_args(_ns_gen(size="1024x1024"))

    def test_valid_ratio_tier_passes(self, gen_env):
        main._validate_gen_args(_ns_gen(size=None, ratio="9:16", tier="2K"))


# ---------- _resolve_output ----------

class TestResolveOutput:
    def test_file_path_used_directly(self, gen_env):
        out = str(gen_env / "deeper" / "out.png")
        path, dir_, fmt = main._resolve_output(_ns_gen(output=out))
        assert path == out
        assert dir_ == str(gen_env / "deeper")
        assert fmt == "png"
        assert (gen_env / "deeper").is_dir()

    def test_directory_generates_filename(self, gen_env):
        # 先建目录，让 os.path.isdir 命中目录分支
        out_dir = gen_env / "outputs"
        out_dir.mkdir()
        path, dir_, fmt = main._resolve_output(_ns_gen(output=str(out_dir)))
        assert dir_ == str(out_dir)
        assert fmt == "png"
        # 自动生成的文件名位于该目录下
        assert os.path.dirname(path) == str(out_dir)
        assert path.endswith(".png")

    def test_trailing_slash_treated_as_directory(self, gen_env):
        out = str(gen_env / "outputs") + os.sep
        path, dir_, fmt = main._resolve_output(_ns_gen(output=out))
        assert dir_ == str(gen_env / "outputs")
        assert os.path.dirname(path) == str(gen_env / "outputs")
        assert path.endswith(".png")

    def test_format_fallback_when_no_extension(self, gen_env):
        out = str(gen_env / "noext_out")
        path, dir_, fmt = main._resolve_output(_ns_gen(output=out, format="webp"))
        assert fmt == "webp"
        assert path == out

    def test_extension_overrides_format(self, gen_env):
        out = str(gen_env / "out.jpg")
        _, _, fmt = main._resolve_output(_ns_gen(output=out, format="webp"))
        assert fmt == "jpg"


# ---------- handle_gen_command 端到端 ----------

class TestHandleGenCommand:
    def test_txt2img_logs_and_persists_submission(self, gen_env, monkeypatch):
        out = str(gen_env / "out.png")
        main.handle_gen_command(_ns_gen(output=out))

        # 账本：一行 ok 记录，含 submission_id + asset_ids
        log_path = gen_env / "logs" / "generation.jsonl"
        record = json.loads(log_path.read_text(encoding="utf-8"))
        assert record["status"] == "ok"
        assert record["mode"] == "txt2img"
        assert record["refs"] == 0
        assert record["size"] == "1024x1024"
        assert record["quality"] == "high"
        assert record["output"]
        assert record["submissionId"]
        assert record["outputAssetIds"]  # 结果图已注册

        # 提交快照文件存在
        sub_files = list((gen_env / "submissions").glob("*.json"))
        assert len(sub_files) == 1

    def test_img2img_with_multiple_refs(self, gen_env):
        # 准备两张参考图
        r1 = gen_env / "ref1.png"
        r2 = gen_env / "ref2.png"
        r1.write_bytes(b"ref1-fake")
        r2.write_bytes(b"ref2-fake")
        out = str(gen_env / "out.png")

        main.handle_gen_command(_ns_gen(
            image=[str(r1), str(r2)], output=out,
        ))

        log_path = gen_env / "logs" / "generation.jsonl"
        record = json.loads(log_path.read_text(encoding="utf-8"))
        assert record["mode"] == "img2img"
        assert record["refs"] == 2
        assert record["inputAssetIds"]  # 参考图已注册
        assert record["outputAssetIds"]

    def test_missing_ref_image_exits_with_code_2(self, gen_env):
        with pytest.raises(SystemExit) as exc:
            main.handle_gen_command(_ns_gen(
                image=[str(gen_env / "nope.png")], output=str(gen_env / "out.png"),
            ))
        assert exc.value.code == 2

    def test_generate_failure_logs_error_and_exits_1(self, gen_env, monkeypatch):
        def _raise(*a, **kw):
            raise RuntimeError("api boom")
        monkeypatch.setattr(main, "generate_image", _raise)

        with pytest.raises(SystemExit) as exc:
            main.handle_gen_command(_ns_gen(output=str(gen_env / "out.png")))
        assert exc.value.code == 1

        log_path = gen_env / "logs" / "generation.jsonl"
        record = json.loads(log_path.read_text(encoding="utf-8"))
        assert record["status"] == "error"
        # 失败不计入提交：submissionId / asset_ids 字段全部缺省
        assert "submissionId" not in record
        assert "outputAssetIds" not in record

    def test_no_asset_skips_submission_persist(self, gen_env):
        out = str(gen_env / "out.png")
        main.handle_gen_command(_ns_gen(output=out, no_asset=True))

        # 账本仍写，但无 submission_id / asset_ids（--no-asset 不生成 submission_id）
        log_path = gen_env / "logs" / "generation.jsonl"
        record = json.loads(log_path.read_text(encoding="utf-8"))
        assert record["status"] == "ok"
        assert "submissionId" not in record
        assert "outputAssetIds" not in record
        # 提交快照不落盘
        assert not (gen_env / "submissions").exists() or not list((gen_env / "submissions").glob("*.json"))

    def test_ratio_tier_path_resolves_size(self, gen_env):
        out = str(gen_env / "out.png")
        main.handle_gen_command(_ns_gen(
            size=None, ratio="9:16", tier="2K", output=out,
        ))
        log_path = gen_env / "logs" / "generation.jsonl"
        record = json.loads(log_path.read_text(encoding="utf-8"))
        # 9:16 2K 档对应 1152x2048
        assert record["size"] == "1152x2048"


# ---------- handle_config_command ----------

class TestHandleConfigCommand:
    def test_config_command_prints_active_profile(self, gen_env, capsys):
        # 不依赖 stdout reconfigure，rich console 直接落到 capsys
        main.handle_config_command(argparse.Namespace())

        out = capsys.readouterr().out
        # 当前 profile 至少打印模型名 + 默认尺寸
        assert "当前 profile" in out
        assert "默认尺寸" in out
        assert "尺寸 SIZE_OPTIONS" in out
        assert "比例 RATIOS" in out
        assert "质量 QUALITY_OPTIONS" in out


# ---------- build_argument_parser ----------

class TestBuildArgumentParser:
    def test_gen_subcommand_required_args(self, gen_env):
        parser = main.build_argument_parser()
        # gen 子命令必须有 prompt 位置参数
        args = parser.parse_args(["gen", "hello", "--size", "1024x1024",
                                  "--quality", "high", "-o", "x.png"])
        assert args.command == "gen"
        assert args.prompt == "hello"
        assert args.size == "1024x1024"
        assert args.quality == "high"
        assert args.output == "x.png"
        assert args.handler is main.handle_gen_command

    def test_config_subcommand_wired(self, gen_env):
        parser = main.build_argument_parser()
        args = parser.parse_args(["config"])
        assert args.command == "config"
        assert args.handler is main.handle_config_command

    def test_gen_supports_multiple_image_flags(self, gen_env):
        parser = main.build_argument_parser()
        args = parser.parse_args([
            "gen", "p", "-i", "a.png", "-i", "b.png",
            "--size", "1024x1024", "--quality", "high", "-o", "o.png",
        ])
        assert args.image == ["a.png", "b.png"]
