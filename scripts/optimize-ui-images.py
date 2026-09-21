#!/usr/bin/env python3
"""批量审计并优化 Cocos UI 的 PNG/JPG 源文件。"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import struct
import sys
import zlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image
except ImportError:
    print(
        "缺少 Pillow。请先运行 npm run ui:images:setup，然后重试。",
        file=sys.stderr,
    )
    raise SystemExit(2)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


DEFAULT_ROOTS = ("assets/resources/ui", "assets/race/ui")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg"}
BACKGROUND_NAMES = ("background", "-bg", "_bg", "/bg/")


@dataclass
class Candidate:
    path: Path
    relative: str
    kind: str
    width: int
    height: int
    old_bytes: int
    new_bytes: int
    encoded: bytes
    detail: str

    @property
    def saved_bytes(self) -> int:
        return self.old_bytes - self.new_bytes

    @property
    def saved_ratio(self) -> float:
        return self.saved_bytes / self.old_bytes if self.old_bytes else 0.0


@dataclass
class ImageInfo:
    path: Path
    relative: str
    width: int
    height: int
    mode: str
    has_alpha: bool
    size_bytes: int
    category: str
    budget_bytes: int
    max_edge: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "审计并批量优化 assets/resources/ui 与 assets/race/ui 中的 PNG/JPG。"
            "默认仅预览；传入 --apply 才会替换文件。"
        )
    )
    parser.add_argument(
        "--root",
        action="append",
        dest="roots",
        help="相对项目根目录的扫描目录；可重复传入。",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="原地应用优化，并在 temp/ui-image-optimizer/backups 下备份原文件。",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="只检查；存在可优化文件时返回非零退出码。",
    )
    parser.add_argument(
        "--fail-on-budget",
        action="store_true",
        help="图片超过建议字节或尺寸预算时也返回非零退出码。",
    )
    parser.add_argument(
        "--allow-lossy-jpeg",
        action="store_true",
        help="显式允许 JPG 有损重编码；默认只优化 PNG，JPG 保持原文件。",
    )
    parser.add_argument(
        "--jpeg-quality",
        type=int,
        default=82,
        choices=range(60, 96),
        metavar="60..95",
        help="配合 --allow-lossy-jpeg 使用的 JPG 目标质量，默认 82。",
    )
    parser.add_argument(
        "--min-saving-percent",
        type=float,
        default=3.0,
        help="替换文件所需的最小节省比例，默认 3。",
    )
    parser.add_argument(
        "--min-saving-bytes",
        type=int,
        default=1024,
        help="替换文件所需的最小节省字节数，默认 1024。",
    )
    return parser.parse_args()


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def find_images(root: Path, relative_roots: Iterable[str]) -> list[Path]:
    images: set[Path] = set()
    for relative_root in relative_roots:
        scan_root = (root / relative_root).resolve()
        try:
            scan_root.relative_to(root)
        except ValueError as error:
            raise ValueError(f"扫描目录必须位于项目内：{scan_root}") from error
        if not scan_root.exists():
            print(f"提示：扫描目录不存在，已跳过：{scan_root}")
            continue
        for path in scan_root.rglob("*"):
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
                images.add(path)
    return sorted(images)


def relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def classify_image(path: Path, width: int, height: int, has_alpha: bool) -> tuple[str, int, int]:
    normalized = path.as_posix().lower()
    basename = path.stem.lower()
    is_background = (
        any(token in basename for token in BACKGROUND_NAMES[:-1])
        or BACKGROUND_NAMES[-1] in normalized
        or (not has_alpha and width >= 720 and height >= 720)
    )
    if is_background:
        return "背景", 256 * 1024, 2048
    if max(width, height) <= 256:
        return "图标", 32 * 1024, 256
    return "透明精灵" if has_alpha else "不透明精灵", 128 * 1024, 1024


def inspect_image(root: Path, path: Path) -> ImageInfo:
    with Image.open(path) as image:
        width, height = image.size
        has_alpha = "A" in image.getbands() or "transparency" in image.info
        mode = image.mode
    category, budget_bytes, max_edge = classify_image(path, width, height, has_alpha)
    return ImageInfo(
        path=path,
        relative=relative_path(root, path),
        width=width,
        height=height,
        mode=mode,
        has_alpha=has_alpha,
        size_bytes=path.stat().st_size,
        category=category,
        budget_bytes=budget_bytes,
        max_edge=max_edge,
    )


# 重编码只替换 PNG 图像数据；保留色彩、方向、像素比例和其他附加块。
# 仅删除不参与渲染的文本注释。直接复用原始块，避免丢失 sRGB/gAMA/cHRM/ICC。
PNG_DATA_CHUNKS = {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}
PNG_TEXT_CHUNKS = {b"tEXt", b"zTXt", b"iTXt"}


def png_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("PNG 签名无效")
    chunks: list[tuple[bytes, bytes]] = []
    offset = 8
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("PNG 数据块不完整")
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError("PNG 数据块长度越界")
        kind = data[offset + 4:offset + 8]
        raw = data[offset:end]
        crc = struct.unpack_from(">I", data, end - 4)[0]
        if zlib.crc32(data[offset + 4:end - 4]) != crc:
            raise ValueError("PNG 数据块校验失败")
        chunks.append((kind, raw))
        offset = end
    if not chunks or chunks[0][0] != b"IHDR" or chunks[-1][0] != b"IEND":
        raise ValueError("PNG 缺少文件头或结尾")
    return chunks


def preserve_png_metadata(original: bytes, encoded: bytes) -> bytes:
    # 原数据块顺序保留；新图像数据写回原 IDAT 所在位置。
    replacement: dict[bytes, list[bytes]] = {}
    for kind, raw in png_chunks(encoded):
        if kind in PNG_DATA_CHUNKS:
            replacement.setdefault(kind, []).append(raw)
    output = [original[:8]]
    written: set[bytes] = set()
    for kind, raw in png_chunks(original):
        if kind in PNG_TEXT_CHUNKS:
            continue
        if kind in PNG_DATA_CHUNKS:
            if kind not in written:
                output.extend(replacement.get(kind, []))
                written.add(kind)
        else:
            output.append(raw)
    # 调色板/透明色键结构不应凭空增加，否则需要另外处理块顺序。
    if set(replacement) - written:
        raise ValueError("PNG 重编码产生新的图像块类型")
    return b"".join(output)


def png_candidate(info: ImageInfo) -> tuple[bytes, str]:
    original = info.path.read_bytes()
    source_chunks = png_chunks(original)
    # 这些格式需要保留逐帧/高精度数据，当前工具不尝试转换。
    if any(kind == b"acTL" for kind, _ in source_chunks):
        return original, "动画 PNG 保持原文件"
    if source_chunks[0][1][16] == 16:
        return original, "16 位 PNG 保持原文件"
    with Image.open(info.path) as image:
        image.load()
        original_rgba = image.convert("RGBA").tobytes()
        save_options: dict[str, object] = {
            "format": "PNG",
            "optimize": True,
            "compress_level": 9,
        }
        if image.info.get("icc_profile"):
            save_options["icc_profile"] = image.info["icc_profile"]
        if "transparency" in image.info:
            save_options["transparency"] = image.info["transparency"]
        output = io.BytesIO()
        image.save(output, **save_options)
        encoded = preserve_png_metadata(original, output.getvalue())

    with Image.open(io.BytesIO(encoded)) as decoded:
        decoded.load()
        if decoded.size != (info.width, info.height):
            raise ValueError("PNG 重编码后尺寸发生变化")
        if decoded.convert("RGBA").tobytes() != original_rgba:
            raise ValueError("PNG 重编码后像素发生变化")
    return encoded, "无损像素重编码，保留色彩与方向信息"


_JPEG_QUALITY_TABLES: dict[int, tuple[tuple[int, ...], ...]] | None = None


def jpeg_quality_tables() -> dict[int, tuple[tuple[int, ...], ...]]:
    global _JPEG_QUALITY_TABLES
    if _JPEG_QUALITY_TABLES is not None:
        return _JPEG_QUALITY_TABLES
    tables: dict[int, tuple[tuple[int, ...], ...]] = {}
    sample = Image.new("RGB", (8, 8), (127, 127, 127))
    for quality in range(1, 101):
        output = io.BytesIO()
        sample.save(output, format="JPEG", quality=quality)
        with Image.open(io.BytesIO(output.getvalue())) as encoded:
            quantization = encoded.quantization or {}
            tables[quality] = tuple(tuple(quantization[key]) for key in sorted(quantization))
    _JPEG_QUALITY_TABLES = tables
    return tables


def estimate_jpeg_quality(image: Image.Image) -> int | None:
    source = image.quantization or {}
    if not source:
        return None
    source_tables = tuple(tuple(source[key]) for key in sorted(source))

    def distance(candidate: tuple[tuple[int, ...], ...]) -> float:
        table_count = min(len(source_tables), len(candidate))
        if table_count == 0:
            return float("inf")
        total = 0
        values = 0
        for index in range(table_count):
            pair_count = min(len(source_tables[index]), len(candidate[index]))
            total += sum(
                abs(source_tables[index][item] - candidate[index][item])
                for item in range(pair_count)
            )
            values += pair_count
        return total / values if values else float("inf")

    return min(jpeg_quality_tables(), key=lambda quality: distance(jpeg_quality_tables()[quality]))


def jpeg_candidate(info: ImageInfo, target_quality: int) -> tuple[bytes | None, str]:
    with Image.open(info.path) as image:
        image.load()
        estimated_quality = estimate_jpeg_quality(image)
        quality_note = f"估算原质量 {estimated_quality}" if estimated_quality else "原质量未知"
        if estimated_quality is not None and estimated_quality <= target_quality:
            return None, f"{quality_note}，不重复有损重编码"
        if image.info.get("exif"):
            exif = image.getexif()
            orientation = exif.get(274, 1)
            if orientation not in (None, 1):
                return None, f"检测到 EXIF 方向 {orientation}，为避免改变显示方向已跳过"
        rgb = image.convert("RGB")
        output = io.BytesIO()
        save_options: dict[str, object] = {
            "format": "JPEG",
            "quality": target_quality,
            "optimize": True,
            "progressive": True,
            "subsampling": "4:2:0",
        }
        if image.info.get("icc_profile"):
            save_options["icc_profile"] = image.info["icc_profile"]
        rgb.save(output, **save_options)
        encoded = output.getvalue()

    with Image.open(io.BytesIO(encoded)) as decoded:
        if decoded.size != (info.width, info.height):
            raise ValueError("JPG 重编码后尺寸发生变化")
    return encoded, f"{quality_note} → 质量 {target_quality}"


def build_candidate(
    info: ImageInfo,
    jpeg_quality: int,
    min_saving_percent: float,
    min_saving_bytes: int,
    allow_lossy_jpeg: bool = False,
) -> tuple[Candidate | None, str | None]:
    if info.path.suffix.lower() == ".png":
        encoded, detail = png_candidate(info)
    else:
        if not allow_lossy_jpeg:
            return None, "无损模式：JPG 保持原文件"
        encoded, detail = jpeg_candidate(info, jpeg_quality)
        if encoded is None:
            return None, detail

    new_bytes = len(encoded)
    saved_bytes = info.size_bytes - new_bytes
    saved_ratio = saved_bytes / info.size_bytes if info.size_bytes else 0.0
    if saved_bytes < min_saving_bytes or saved_ratio < min_saving_percent / 100:
        return None, detail
    return (
        Candidate(
            path=info.path,
            relative=info.relative,
            kind=info.path.suffix.lower().lstrip(".").upper(),
            width=info.width,
            height=info.height,
            old_bytes=info.size_bytes,
            new_bytes=new_bytes,
            encoded=encoded,
            detail=detail,
        ),
        None,
    )


def format_kib(value: int) -> str:
    return f"{value / 1024:.1f} KiB"


def print_candidates(candidates: list[Candidate]) -> None:
    if not candidates:
        print("没有发现达到节省阈值的图片。")
        return
    print("\n可优化图片：")
    for candidate in sorted(candidates, key=lambda item: item.saved_bytes, reverse=True):
        print(
            f"- {candidate.relative}: {format_kib(candidate.old_bytes)} → "
            f"{format_kib(candidate.new_bytes)}，节省 {candidate.saved_ratio * 100:.1f}%"
            f"（{candidate.detail}）"
        )


def collect_budget_warnings(infos: list[ImageInfo], candidates: list[Candidate]) -> list[str]:
    predicted_sizes = {candidate.path: candidate.new_bytes for candidate in candidates}
    warnings: list[str] = []
    for info in infos:
        predicted_size = predicted_sizes.get(info.path, info.size_bytes)
        problems: list[str] = []
        if predicted_size > info.budget_bytes:
            problems.append(
                f"预计 {format_kib(predicted_size)} > {info.category}建议 {format_kib(info.budget_bytes)}"
            )
        if max(info.width, info.height) > info.max_edge:
            problems.append(
                f"尺寸 {info.width}x{info.height} > 建议最长边 {info.max_edge}px"
            )
        if problems:
            warnings.append(f"{info.relative}: {'；'.join(problems)}")
    return warnings


def apply_candidates(root: Path, candidates: list[Candidate]) -> Path | None:
    if not candidates:
        return None
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = root / "temp" / "ui-image-optimizer" / "backups" / timestamp
    for candidate in candidates:
        backup_path = backup_root / candidate.relative
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidate.path, backup_path)

        temporary = candidate.path.with_name(f".{candidate.path.name}.uiopt.tmp")
        try:
            temporary.write_bytes(candidate.encoded)
            os.replace(temporary, candidate.path)
        finally:
            if temporary.exists():
                temporary.unlink()
    return backup_root


def main() -> int:
    args = parse_args()
    root = project_root()
    roots = args.roots or list(DEFAULT_ROOTS)
    try:
        paths = find_images(root, roots)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    if not paths:
        print("没有找到 PNG/JPG 图片。")
        return 0

    infos: list[ImageInfo] = []
    candidates: list[Candidate] = []
    errors: list[str] = []
    for path in paths:
        try:
            info = inspect_image(root, path)
            infos.append(info)
            candidate, _ = build_candidate(
                info,
                jpeg_quality=args.jpeg_quality,
                min_saving_percent=args.min_saving_percent,
                min_saving_bytes=args.min_saving_bytes,
                allow_lossy_jpeg=args.allow_lossy_jpeg,
            )
            if candidate:
                candidates.append(candidate)
        except Exception as error:  # 单张坏图不应阻止其余资源完成审计。
            errors.append(f"{relative_path(root, path)}: {error}")

    total_bytes = sum(info.size_bytes for info in infos)
    total_after = total_bytes - sum(candidate.saved_bytes for candidate in candidates)
    print(
        f"扫描 {len(infos)} 张图片：{format_kib(total_bytes)}；"
        f"按当前策略预计 {format_kib(total_after)}，可节省 {format_kib(total_bytes - total_after)}。"
    )
    if not args.allow_lossy_jpeg:
        print("当前为无损模式：PNG 保留像素、色彩信息和透明度；JPG 不重编码。")
    print_candidates(candidates)

    budget_warnings = collect_budget_warnings(infos, candidates)
    if budget_warnings:
        print("\n预算提示（只报告，不会自动缩放或转格式）：")
        for warning in budget_warnings:
            print(f"- {warning}")

    if errors:
        print("\n处理错误：", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)

    if args.apply:
        backup_root = apply_candidates(root, candidates)
        if backup_root:
            print(f"\n已优化 {len(candidates)} 张图片；原文件备份：{backup_root}")
            print("请让 Cocos Creator 完成重新导入后，再运行 npm run textures:fix 与 npm run textures:check。")
        else:
            print("\n没有文件需要替换。")

    if errors:
        return 2
    if args.check and candidates:
        return 1
    if args.fail_on_budget and budget_warnings:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
