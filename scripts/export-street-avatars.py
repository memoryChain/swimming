"""将已定稿头像导出为带抗锯齿圆形透明通道的运行时纹理。"""
import json
import re
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/avatar-street-v2'
SIZE = 256

def main():
    entries = json.loads((SOURCE / 'manifest.json').read_text())
    paths = re.findall(r"'ui/avatar-picker-v1/(avatar-\d+[^']*)/texture'",
                       (ROOT / 'assets/scripts/core/ResourcePaths.ts').read_text())
    assert len(entries) == len(paths) == 10
    # 超采样仅用于导出抗锯齿，运行时无需额外遮罩和绘制节点。
    mask = Image.new('L', (SIZE * 4, SIZE * 4))
    ImageDraw.Draw(mask).ellipse((0, 0, SIZE * 4 - 1, SIZE * 4 - 1), fill=255)
    mask = mask.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    for entry, name in zip(entries, paths):
        src = Image.open(SOURCE / entry['file']).convert('RGB')
        assert src.width == src.height
        image = src.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        # 保留透明像素的原始颜色，避免线性采样产生黑色或白色杂边。
        image.putalpha(mask)
        dest = ROOT / 'assets/race/ui/avatar-picker-v1' / (name + '.png')
        assert dest.with_suffix('.png.meta').exists()
        image.save(dest, optimize=True)
        print(dest.relative_to(ROOT))

if __name__ == '__main__':
    main()
