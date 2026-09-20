#!/usr/bin/env python3
"""整理已批准的透明徽章；保留源稿，只输出运行时尺寸与可复现清单。"""
from pathlib import Path
import argparse
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets/race/ui/career-v1'
DEST.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--badge', choices=[f'badge-{tier}{suffix}' for tier in range(1, 7) for suffix in ('', '-locked')], help='只重新导出指定徽章')
args = parser.parse_args()
manifest_path = ROOT / 'art/career-ui/runtime-assets.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'canvas': [1280, 720], 'bundle': 'race', 'badges': []}
source_overrides = {'badge-2': ROOT / 'art/career-badges/edge-fix-02/career-badge-02-edge-fixed.png'}
exported = 0
for tier in range(1, 7):
    for locked in (False, True):
        suffix = '-locked' if locked else ''
        name = f'badge-{tier}{suffix}'
        if args.badge and args.badge != name:
            continue
        source = ROOT / ('art/career-badges/locked/png' if locked else 'art/career-badges/transparent-png-v1') / f'career-badge-{tier:02}{suffix}.png'
        source = source_overrides.get(name, source)
        image = Image.open(source).convert('RGBA')
        bounds = image.getchannel('A').point(lambda a: 255 if a > 2 else 0).getbbox()
        if not bounds:
            raise ValueError(f'徽章为空：{source}')
        # 去掉不同源稿中的透明留白，运行时按可见主体统一contain定位。
        image = image.crop(bounds)
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        output = DEST / f'badge-{tier}{suffix}.png'
        image.save(output, optimize=True)
        entry = {'source': str(source.relative_to(ROOT)), 'output': str(output.relative_to(ROOT)), 'sourceCrop': bounds, 'size': image.size}
        existing = next((i for i, item in enumerate(manifest['badges']) if item['output'] == entry['output']), None)
        if existing is None:
            manifest['badges'].append(entry)
        else:
            manifest['badges'][existing] = entry
        exported += 1
for output in DEST.glob('*.png'):
    if args.badge and output.stem != args.badge:
        continue
    image = Image.open(output).convert('RGBA')
    image.save(output, optimize=True)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'已整理 {exported} 个徽章，运行时PNG共 {sum(p.stat().st_size for p in DEST.glob("*.png")) / 1024:.0f} KiB')
