#!/usr/bin/env python3
"""为现有抖音构建制作独立的本地 ZIP 测试包，保留全部资源与原构建。"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
TOOLING = PROJECT / "temp/douyin-package-tools/python"
if TOOLING.exists():
    sys.path.insert(0, str(TOOLING))
from PIL import Image

MAX_BYTES = 20 * 1024 * 1024
IGNORED = {".map", ".bak"}


def inside_project(value: str) -> Path:
    result = (PROJECT / value).resolve()
    result.relative_to(PROJECT)
    if result == PROJECT or PROJECT not in result.parents:
        raise ValueError("目标必须位于项目子目录中")
    return result


def lossless_png(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        pixels = image.convert("RGBA").tobytes()
        size = image.size
        options = {"format": "PNG", "optimize": True, "compress_level": 9}
        for key in ("icc_profile", "transparency"):
            if key in image.info:
                options[key] = image.info[key]
        out = io.BytesIO()
        image.save(out, **options)
    result = out.getvalue()
    if len(result) >= len(data):
        return data
    with Image.open(io.BytesIO(result)) as decoded:
        if decoded.size != size or decoded.convert("RGBA").tobytes() != pixels:
            raise ValueError("PNG 无损验证失败")
    return result


def package_bundle(bundle: Path) -> dict:
    config_path = bundle / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("isZip"):
        raise ValueError(f"输入 Bundle 已压缩：{bundle.name}")
    files = sorted(p for folder in ("import", "native")
                   for p in (bundle / folder).rglob("*") if p.is_file())
    if not files:
        return {"name": bundle.name, "files": 0}
    expected = {}
    png_saved = 0
    raw_size = 0
    archive_path = bundle / "res.pending.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED,
                         compresslevel=9, allowZip64=False) as archive:
        for file in files:
            if file.suffix == ".js":
                raise ValueError("程序脚本不能放进资源压缩包")
            content = file.read_bytes()
            raw_size += len(content)
            optimized = lossless_png(content) if file.suffix.lower() == ".png" else content
            png_saved += len(content) - len(optimized)
            entry = "res/" + file.relative_to(bundle).as_posix()
            info = zipfile.ZipInfo(entry, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, optimized, compress_type=zipfile.ZIP_DEFLATED,
                             compresslevel=9)
            expected[entry] = hashlib.sha256(optimized).hexdigest()
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(expected):
            raise ValueError("ZIP 文件清单或 CRC 校验失败")
        for name, digest in expected.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != digest:
                raise ValueError(f"ZIP 内容校验失败：{name}")
    version = hashlib.sha256(archive_path.read_bytes()).hexdigest()[:16]
    final_archive = bundle / f"res.{version}.zip"
    archive_path.rename(final_archive)
    config["isZip"] = True
    config["zipVersion"] = version
    config_path.write_text(json.dumps(config, ensure_ascii=False, separators=(",", ":")),
                           encoding="utf-8")
    # 仅移除独立输出副本中的已验证资源，原构建与源美术均不修改。
    for folder in ("import", "native"):
        target = (bundle / folder).resolve()
        target.relative_to(bundle.resolve())
        if target.exists():
            shutil.rmtree(target)
    return {"name": bundle.name, "files": len(files), "rawBytes": raw_size,
            "zipBytes": final_archive.stat().st_size, "pngSavedBytes": png_saved,
            "zipVersion": version}


def prepare(source: Path, output: Path) -> dict:
    if output.exists():
        raise ValueError(f"输出目录已存在，指定新的 --output 以保留旧包：{output}")
    if output == source or source in output.parents or output in source.parents:
        raise ValueError("输入输出目录不能相互包含")
    project_config = json.loads((source / "project.config.json").read_text(encoding="utf-8"))
    game = json.loads((source / "game.json").read_text(encoding="utf-8"))
    settings = json.loads((source / "src/settings.json").read_text(encoding="utf-8"))
    adapter = (source / "engine-adapter.js").read_text(encoding="utf-8")
    if not all(token in adapter for token in (".isZip", ".zipVersion", "unzipAndCacheBundle")):
        raise ValueError("当前引擎适配器缺少 ZIP 加载能力")
    if not project_config.get("appid", "").startswith("tt"):
        raise ValueError("输入必须是抖音构建包")
    if game.get("subpackages") or settings.get("assets", {}).get("subpackages"):
        raise ValueError("此测试脚本只接受普通本地 Bundle，不能混改小游戏分包")
    if settings.get("assets", {}).get("remoteBundles"):
        raise ValueError("此测试脚本不能处理远程 Bundle")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="douyin-local-staging-", dir=output.parent)).resolve()
    staging.relative_to(PROJECT)
    # 出错时保留临时副本，方便排查，不触碰原目录。
    shutil.copytree(source, staging, dirs_exist_ok=True,
                    ignore=lambda directory, names: [n for n in names
                                                    if Path(n).suffix in IGNORED])
    # 仅对新的独立输出安装启动监听，不修改原构建；避免依赖编辑器已加载扩展。
    subprocess.run(["node", str(PROJECT / "extensions/douyin-platform-tools/hooks.js"), str(staging)], check=True)
    bundles = [package_bundle(b) for b in sorted((staging / "assets").iterdir())
               if b.is_dir() and (b / "config.json").exists()]
    source_bytes = sum(p.stat().st_size for p in source.rglob("*")
                       if p.is_file() and p.suffix not in IGNORED)
    output_bytes = sum(p.stat().st_size for p in staging.rglob("*") if p.is_file())
    if output_bytes >= MAX_BYTES:
        raise ValueError(f"压缩后仍超过 20MiB：{output_bytes / 1048576:.4f}；副本位于 {staging}")
    # 仅允许 game.js 增加经过验证的启动监听；其他已有脚本逐字节一致。
    for original in source.rglob("*.js"):
        copied = staging / original.relative_to(source)
        expected = original.read_bytes()
        prefix = b"require('./douyin-launch-bootstrap.js');\n"
        if original.relative_to(source).as_posix() == "game.js" and not expected.startswith(prefix[:-1]):
            expected = prefix + expected
        if not copied.exists() or copied.read_bytes() != expected:
            raise ValueError(f"脚本保真校验失败：{original}")
    staging.rename(output)
    return {"source": str(source.relative_to(PROJECT)),
            "output": str(output.relative_to(PROJECT)), "sourceBytes": source_bytes,
            "outputBytes": output_bytes, "limitBytes": MAX_BYTES, "bundles": bundles,
            "launchBootstrapInstalled": True, "deviceVerified": False}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="build/bytedance-mini-game")
    parser.add_argument("--output", default="build/douyin-local-preview")
    args = parser.parse_args()
    report = prepare(inside_project(args.source), inside_project(args.output))
    report_dir = PROJECT / "temp/douyin-package-tools"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_name = "local-preview-report.json" if Path(args.output).name == "douyin-local-preview" else Path(args.output).name + "-report.json"
    (report_dir / report_name).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"测试包生成：{report['output']}")
    print(f"大小：{report['sourceBytes'] / 1048576:.4f} → {report['outputBytes'] / 1048576:.4f} MiB")
    print("已验证 ZIP 内容、PNG 像素和 JavaScript 保真；仍需模拟器与真机验收。")


if __name__ == "__main__":
    main()
