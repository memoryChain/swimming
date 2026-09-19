#!/usr/bin/env python3
"""整理已批准的透明徽章；保留源稿，只输出运行时尺寸与可复现清单。"""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets/race/ui/career-v1'
DEST.mkdir(parents=True, exist_ok=True)
manifest = {'canvas': [1280, 720], 'bundle': 'race', 'badges': []}
for tier in range(1, 7):
    for locked in (False, True):
        suffix = '-locked' if locked else ''
        source = ROOT / ('art/career-badges/locked/png' if locked else 'art/career-badges/transparent-png-v1') / f'career-badge-{tier:02}{suffix}.png'
        image = Image.open(source).convert('RGBA')
        bounds = image.getchannel('A').point(lambda a: 255 if a > 2 else 0).getbbox()
        if not bounds:
            raise ValueError(f'徽章为空：{source}')
        # 去掉不同源稿中的透明留白，运行时按可见主体统一contain定位。
        image = image.crop(bounds)
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        output = DEST / f'badge-{tier}{suffix}.png'
        image.save(output, optimize=True)
        manifest['badges'].append({'source': str(source.relative_to(ROOT)), 'output': str(output.relative_to(ROOT)), 'sourceCrop': bounds, 'size': image.size})
for output in DEST.glob('*.png'):
    image = Image.open(output).convert('RGBA')
    image.save(output, optimize=True)
(ROOT / 'art/career-ui/runtime-assets.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'已整理 {len(manifest["badges"])} 个徽章，运行时PNG共 {sum(p.stat().st_size for p in DEST.glob("*.png")) / 1024:.0f} KiB')
