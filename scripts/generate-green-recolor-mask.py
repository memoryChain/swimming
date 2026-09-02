#!/usr/bin/env python3
"""Generate a Cocos swimmer recolor mask from green-key character art.

The output follows the project's SwimmerDynamicColor contract:
red = recolorable garment, green = optional cap, blue = skin, alpha = opaque.
"""

from __future__ import annotations

import argparse
import colorsys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def green_weight(red: int, green: int, blue: int) -> float:
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
    return min(hue_weight, dominance_weight, saturation_weight, value_weight)


def skin_weight(red: int, green: int, blue: int) -> float:
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
    return min(hue_weight, warm_weight, red_weight, saturation_weight, value_weight)


PREVIEW_PALETTES = {
    "porcelain_red": ((255, 224, 205), (240, 68, 58)),
    "deep_red": ((118, 76, 58), (255, 11, 11)),
    "warm_blue": ((232, 172, 126), (23, 109, 218)),
    "deep_yellow": ((118, 76, 58), (255, 209, 42)),
    "dark_cyan": ((91, 61, 45), (24, 199, 216)),
    "cool_purple": ((205, 154, 132), (139, 77, 255)),
}


def build_mask(source_path: Path, output_path: Path) -> tuple[int, int, int, int, int]:
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
                garment_weight = green_weight(*pixel)
                skin_coverage = skin_weight(*pixel) * (1.0 - garment_weight)
                garment_pixels[x, y] = round(garment_weight * 255.0)
                skin_pixels[x, y] = round(skin_coverage * 255.0)

        # Fill only small dark holes enclosed by confidently detected skin. This
        # softens baked facial/body hatch marks after recolouring while keeping
        # the exterior comic contour and garment boundaries intact.
        closed_skin = skin_plane.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
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
        return garment_nonzero, garment_solid, skin_nonzero, skin_solid, pixel_count


def build_previews(source_path: Path, mask_path: Path, preview_dir: Path) -> None:
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
            preview.save(preview_dir / f"CartonSwimmer3_{name}.png", format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate garment and skin channels for the swimmer recolor mask."
    )
    parser.add_argument("--input", required=True, type=Path, help="Source base-color texture")
    parser.add_argument("--output", required=True, type=Path, help="Output RGBA PNG mask")
    parser.add_argument(
        "--preview-dir",
        type=Path,
        help="Optional directory for five high-contrast validation textures",
    )
    args = parser.parse_args()

    garment_nonzero, garment_solid, skin_nonzero, skin_solid, pixel_count = build_mask(args.input, args.output)
    if args.preview_dir:
        build_previews(args.input, args.output, args.preview_dir)
    print(
        f"character recolor mask: {args.output} "
        f"garment_nonzero={garment_nonzero}/{pixel_count} ({garment_nonzero / pixel_count:.2%}) "
        f"garment_solid={garment_solid}/{pixel_count} ({garment_solid / pixel_count:.2%}) "
        f"skin_nonzero={skin_nonzero}/{pixel_count} ({skin_nonzero / pixel_count:.2%}) "
        f"skin_solid={skin_solid}/{pixel_count} ({skin_solid / pixel_count:.2%})"
    )


if __name__ == "__main__":
    main()
