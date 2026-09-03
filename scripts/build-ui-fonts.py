#!/usr/bin/env python3
"""从工程静态文案自动构建划水大师 UI 字体子集。"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
except ImportError as error:
    raise SystemExit("缺少 fontTools。请先运行 `pnpm fonts:setup`。") from error


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(__file__).with_name("ui-font-config.json")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_glyphs(config: dict) -> tuple[str, list[str]]:
    extensions = {value.lower() for value in config["scan"]["extensions"]}
    files: list[Path] = []
    for relative_root in config["scan"]["roots"]:
        root = PROJECT_ROOT / relative_root
        if root.exists():
            files.extend(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in extensions)
    files.sort()

    glyphs = set(config["scan"]["alwaysInclude"])
    for path in files:
        for character in path.read_text(encoding="utf-8"):
            if ord(character) >= 0xA0 and ord(character) != 0xFEFF:
                glyphs.add(character)
    glyph_text = "".join(sorted(glyphs, key=ord))
    relative_files = [path.relative_to(PROJECT_ROOT).as_posix() for path in files]
    return glyph_text, relative_files


def download_source(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    print(f"[ui-font] 下载固定版本字体源：{url}")
    try:
        with urllib.request.urlopen(url, timeout=90) as response, partial.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        partial.replace(destination)
    except Exception:
        partial.unlink(missing_ok=True)
        raise


def set_name(font: TTFont, name_id: int, value: str) -> None:
    name_table = font["name"]
    name_table.setName(value, name_id, 3, 1, 0x409)
    name_table.setName(value, name_id, 1, 0, 0)


def build_subset(source_path: Path, glyph_text: str, output: dict) -> None:
    font = TTFont(source_path)
    if "fvar" in font:
        font = instantiateVariableFont(font, {"wght": output["weight"]}, inplace=False)

    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_legacy = True
    options.name_languages = [0x409]
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.drop_tables = []
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=glyph_text)
    subsetter.subset(font)

    family = output["family"]
    subfamily = output["subfamily"]
    set_name(font, 1, family)
    set_name(font, 2, subfamily)
    set_name(font, 3, f"{family} {subfamily}")
    set_name(font, 4, f"{family} {subfamily}")
    set_name(font, 6, output["postscriptName"])

    destination = PROJECT_ROOT / output["path"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    font.save(destination, reorderTables=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="使用本地字体源，便于离线或内网构建")
    args = parser.parse_args()

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cached_source = PROJECT_ROOT / config["source"]["cachePath"]
    source = args.source.resolve() if args.source else cached_source
    if not source.exists():
        download_source(config["source"]["url"], source)
    actual_source_hash = sha256(source)
    expected_source_hash = config["source"]["sha256"]
    if actual_source_hash != expected_source_hash:
        raise SystemExit(
            "字体源校验失败：文件并非项目锁定的 Noto Sans SC 2.004。"
            f"\n期望：{expected_source_hash}\n实际：{actual_source_hash}"
        )
    if args.source and source != cached_source:
        cached_source.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, cached_source)
        source = cached_source

    glyph_text, scanned_files = collect_glyphs(config)
    glyph_hash = hashlib.sha256(glyph_text.encode("utf-8")).hexdigest()
    print(f"[ui-font] 扫描 {len(scanned_files)} 个文件，收集 {len(glyph_text)} 个字符。")

    output_manifest = []
    for output in config["outputs"]:
        build_subset(source, glyph_text, output)
        path = PROJECT_ROOT / output["path"]
        output_manifest.append({
            "path": output["path"],
            "weight": output["weight"],
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        })
        print(f"[ui-font] 已生成 {output['path']}（{path.stat().st_size / 1024:.1f} KiB）")

    glyph_path = PROJECT_ROOT / config["glyphListPath"]
    glyph_path.parent.mkdir(parents=True, exist_ok=True)
    glyph_path.write_text(glyph_text + "\n", encoding="utf-8")
    manifest_path = PROJECT_ROOT / config["manifestPath"]
    manifest_path.write_text(json.dumps({
        "schemaVersion": config["schemaVersion"],
        "source": {
            "family": config["source"]["family"],
            "version": config["source"]["version"],
            "sha256": actual_source_hash,
            "license": config["source"]["license"],
        },
        "glyphHash": glyph_hash,
        "glyphCount": len(glyph_text),
        "scannedFileCount": len(scanned_files),
        "outputs": output_manifest,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("[ui-font] 字体、字符清单和校验清单已同步。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
