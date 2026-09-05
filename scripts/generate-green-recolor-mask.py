#!/usr/bin/env python3
"""Generate a Cocos swimmer recolor mask from green-key character art.

The output follows the project's SwimmerDynamicColor contract:
red = recolorable garment, green = optional cap, blue = skin, alpha = opaque.
"""

from __future__ import annotations

import argparse
import colorsys
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def green_weight(red: int, green: int, blue: int, palette: str = "default") -> float:
    r = red / 255.0
    g = green / 255.0
    b = blue / 255.0
    hue, saturation, value = colorsys.rgb_to_hsv(r, g, b)
    hue_degrees = hue * 360.0
    hue_distance = abs(hue_degrees - 120.0)
    hue_weight = 1.0 - smoothstep(38.0, 63.0, hue_distance)
    dominance_weight = smoothstep(0.025, 0.18, g - max(r, b))
    saturation_weight = smoothstep(0.12, 0.48, saturation)
    value_weight = smoothstep(0.05, 0.28, value)
    if palette == "lime":
        # 黄绿色装备仍要求绿色占优，排除同图集中的橙色帽子和暖肤色。
        hue_weight = 1.0 - smoothstep(25.0, 45.0, abs(hue_degrees - 90.0))
        dominance_weight = smoothstep(0.01, 0.065, g - max(r, b))
    return min(hue_weight, dominance_weight, saturation_weight, value_weight)


def skin_weight(red: int, green: int, blue: int, palette: str = "default") -> float:
    r = red / 255.0
    g = green / 255.0
    b = blue / 255.0
    hue, saturation, value = colorsys.rgb_to_hsv(r, g, b)
    hue_degrees = hue * 360.0
    hue_distance = min(abs(hue_degrees - 20.0), abs(hue_degrees - 380.0))
    hue_weight = 1.0 - smoothstep(20.0, 48.0, hue_distance)
    warm_weight = smoothstep(0.018, 0.16, r - b)
    red_weight = smoothstep(0.004, 0.11, r - g)
    saturation_weight = smoothstep(0.045, 0.34, saturation)
    value_weight = smoothstep(0.10, 0.42, value)
    coverage = min(hue_weight, warm_weight, red_weight, saturation_weight, value_weight)
    if palette == "light-peach":
        # 浅桃色皮肤与棕发、粉色配件同图集时，排除暗棕色与偏洋红区域。
        coverage *= smoothstep(0.76, 0.84, r) * smoothstep(0.008, 0.05, g - b)
    elif palette == "peach-orange":
        # 桃色皮肤与高饱和橙色装备分离，保留皮肤阴影和原有细节。
        coverage *= 1.0 - smoothstep(0.48, 0.68, saturation)
    return coverage


def remove_small_garment_components(plane: Image.Image, minimum_weighted_pixels: float) -> tuple[int, int]:
    """Remove isolated green flecks while preserving anti-aliased block edges."""
    if minimum_weighted_pixels <= 0:
        return 0, 0
    pixels = plane.load()
    width, height = plane.size
    visited = bytearray(width * height)
    removed_components = 0
    removed_pixels = 0
    for start_y in range(height):
        for start_x in range(width):
            flat = start_y * width + start_x
            if visited[flat] or pixels[start_x, start_y] < 8:
                continue
            queue = deque([(start_x, start_y)])
            visited[flat] = 1
            component = []
            total_weight = 0
            while queue:
                x, y = queue.popleft()
                value = pixels[x, y]
                component.append((x, y))
                total_weight += value
                for next_y in range(max(0, y - 1), min(height, y + 2)):
                    for next_x in range(max(0, x - 1), min(width, x + 2)):
                        next_flat = next_y * width + next_x
                        if visited[next_flat] or pixels[next_x, next_y] < 8:
                            continue
                        visited[next_flat] = 1
                        queue.append((next_x, next_y))
            if total_weight / 255.0 < minimum_weighted_pixels:
                removed_components += 1
                removed_pixels += len(component)
                for x, y in component:
                    pixels[x, y] = 0
    return removed_components, removed_pixels


def solidify_garment_components(plane: Image.Image) -> None:
    """Make retained green blocks opaque while keeping a narrow soft outer edge."""
    pixels = plane.load()
    width, height = plane.size
    solid = Image.new("L", plane.size, 0)
    solid_pixels = solid.load()
    for y in range(height):
        for x in range(width):
            if pixels[x, y] >= 8:
                solid_pixels[x, y] = 255
    # Close small JPEG/shading holes inside the retained color blocks. The
    # matching erosion returns the outer silhouette to its original extent.
    closed = solid.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    softened = closed.filter(ImageFilter.GaussianBlur(0.45))
    plane.paste(softened)


PREVIEW_PALETTES = {
    "porcelain_red": ((255, 224, 205), (240, 68, 58)),
    "deep_red": ((118, 76, 58), (255, 11, 11)),
    "warm_blue": ((232, 172, 126), (23, 109, 218)),
    "deep_yellow": ((118, 76, 58), (255, 209, 42)),
    "dark_cyan": ((91, 61, 45), (24, 199, 216)),
    "cool_purple": ((205, 154, 132), (139, 77, 255)),
}


def build_mask(source_path: Path, output_path: Path, skin_close_radius: int = 2, skin_palette: str = "default", garment_palette: str = "default", garment_min_component: float = 0.0, garment_solidify: bool = False) -> tuple[int, int, int, int, int, int, int]:
    with Image.open(source_path) as source_image:
        source = source_image.convert("RGB")
        source_pixels = source.load()
        garment_plane = Image.new("L", source.size, 0)
        skin_plane = Image.new("L", source.size, 0)
        garment_pixels = garment_plane.load()
        skin_pixels = skin_plane.load()
        for y in range(source.height):
            for x in range(source.width):
                pixel = source_pixels[x, y]
                garment_weight = green_weight(*pixel, palette=garment_palette)
                skin_coverage = skin_weight(*pixel, palette=skin_palette) * (1.0 - garment_weight)
                garment_pixels[x, y] = round(garment_weight * 255.0)
                skin_pixels[x, y] = round(skin_coverage * 255.0)

        removed_components, removed_pixels = remove_small_garment_components(
            garment_plane,
            garment_min_component,
        )
        if garment_solidify:
            solidify_garment_components(garment_plane)

        # Fill only small dark holes enclosed by confidently detected skin. This
        # softens baked facial/body hatch marks after recolouring while keeping
        # the exterior comic contour and garment boundaries intact.
        # 碎片 UV 紧邻白色装备时，允许禁用闭运算，避免把肤色扩到衣服和头发。
        if skin_close_radius > 0:
            kernel = 2 * skin_close_radius + 1
            closed_skin = skin_plane.filter(ImageFilter.MaxFilter(kernel)).filter(ImageFilter.MinFilter(kernel))
            skin_plane = ImageChops.lighter(skin_plane, closed_skin)
        zero_plane = Image.new("L", source.size, 0)
        alpha_plane = Image.new("L", source.size, 255)
        mask = Image.merge("RGBA", (garment_plane, zero_plane, skin_plane, alpha_plane))

        pixel_count = source.width * source.height
        garment_histogram = garment_plane.histogram()
        skin_histogram = skin_plane.histogram()
        garment_nonzero = pixel_count - garment_histogram[0]
        skin_nonzero = pixel_count - skin_histogram[0]
        garment_solid = sum(garment_histogram[128:])
        skin_solid = sum(skin_histogram[128:])
        garment_coverage = sum(value * count for value, count in enumerate(garment_histogram)) / (255.0 * pixel_count)
        skin_coverage = sum(value * count for value, count in enumerate(skin_histogram)) / (255.0 * pixel_count)
        if garment_nonzero == 0 or garment_coverage < 0.001 or garment_coverage > 0.45:
            raise RuntimeError(
                f"Implausible green garment coverage: nonzero={garment_nonzero}, "
                f"weighted={garment_coverage:.4%}"
            )
        if skin_nonzero == 0 or skin_coverage < 0.05 or skin_coverage > 0.65:
            raise RuntimeError(
                f"Implausible skin coverage: nonzero={skin_nonzero}, "
                f"weighted={skin_coverage:.4%}"
            )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        mask.save(output_path, format="PNG", optimize=True)
        return garment_nonzero, garment_solid, skin_nonzero, skin_solid, pixel_count, removed_components, removed_pixels


def build_previews(source_path: Path, mask_path: Path, preview_dir: Path, prefix: str = "Swimmer") -> None:
    with Image.open(source_path) as source_image, Image.open(mask_path) as mask_image:
        source = source_image.convert("RGB")
        mask = mask_image.convert("RGB")
        source_pixels = source.load()
        mask_pixels = mask.load()
        preview_dir.mkdir(parents=True, exist_ok=True)
        for name, (skin_target, garment_target) in PREVIEW_PALETTES.items():
            preview = source.copy()
            preview_pixels = preview.load()
            for y in range(source.height):
                for x in range(source.width):
                    garment_coverage = mask_pixels[x, y][0] / 255.0
                    skin_coverage = mask_pixels[x, y][2] / 255.0
                    if garment_coverage <= 0.0 and skin_coverage <= 0.0:
                        continue
                    base = source_pixels[x, y]
                    luminance = (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]) / 255.0
                    garment_brightness = 0.90 + min(1.0, luminance / 0.42) ** 0.5 * 0.10
                    skin_brightness = max(0.34, min(1.08, 0.34 + min(1.0, luminance / 0.42) ** 0.5 * 0.76))
                    garment_color = tuple(round(channel * garment_brightness) for channel in garment_target)
                    skin_color = tuple(round(min(255.0, channel * skin_brightness)) for channel in skin_target)
                    garment_blend = tuple(
                        base[channel] * (1.0 - garment_coverage) + garment_color[channel] * garment_coverage
                        for channel in range(3)
                    )
                    preview_pixels[x, y] = tuple(
                        round(garment_blend[channel] * (1.0 - skin_coverage) + skin_color[channel] * skin_coverage)
                        for channel in range(3)
                    )
            preview.save(preview_dir / f"{prefix}_{name}.png", format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate garment and skin channels for the swimmer recolor mask."
    )
    parser.add_argument("--input", required=True, type=Path, help="Source base-color texture")
    parser.add_argument("--output", required=True, type=Path, help="Output RGBA PNG mask")
    parser.add_argument("--skin-close-radius", type=int, choices=range(0, 5), default=2,
                        help="皮肤小孔闭运算半径；碎片 UV 紧邻装备时使用 0")
    parser.add_argument("--preview-prefix", default="Swimmer", help="预览文件名前缀")
    parser.add_argument("--skin-palette", choices=("default", "light-peach", "peach-orange"), default="default",
                        help="棕发及粉色配件使用 light-peach；橙色装备与桃色皮肤使用 peach-orange")
    parser.add_argument("--garment-palette", choices=("default", "lime"), default="default",
                        help="偏黄绿色的装备使用 lime；既有角色保持 default")
    parser.add_argument(
        "--garment-min-component",
        type=float,
        default=0.0,
        help="移除小于该等效满权重像素数的孤立绿色连通块；0 保持原行为",
    )
    parser.add_argument(
        "--garment-solidify",
        action="store_true",
        help="将保留的绿色连通块转为实心遮罩，并仅在外缘保留抗锯齿",
    )
    parser.add_argument(
        "--preview-dir",
        type=Path,
        help="Optional directory for five high-contrast validation textures",
    )
    args = parser.parse_args()

    garment_nonzero, garment_solid, skin_nonzero, skin_solid, pixel_count, removed_components, removed_pixels = build_mask(
        args.input,
        args.output,
        args.skin_close_radius,
        args.skin_palette,
        args.garment_palette,
        args.garment_min_component,
        args.garment_solidify,
    )
    if args.preview_dir:
        build_previews(args.input, args.output, args.preview_dir, args.preview_prefix)
    print(
        f"character recolor mask: {args.output} "
        f"garment_nonzero={garment_nonzero}/{pixel_count} ({garment_nonzero / pixel_count:.2%}) "
        f"garment_solid={garment_solid}/{pixel_count} ({garment_solid / pixel_count:.2%}) "
        f"skin_nonzero={skin_nonzero}/{pixel_count} ({skin_nonzero / pixel_count:.2%}) "
        f"skin_solid={skin_solid}/{pixel_count} ({skin_solid / pixel_count:.2%})"
        f" removed_components={removed_components} removed_pixels={removed_pixels}"
    )


if __name__ == "__main__":
    main()
