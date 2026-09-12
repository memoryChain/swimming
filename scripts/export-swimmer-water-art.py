"""从美术源稿导出小尺寸 RGBA 运行时纹理，不生成运行时几何。"""
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
for source, target, size in [
    ('water-sequence-source.png', 'SwimmerSplashDroplet.png', (512, 256)),
    ('surface-atlas-source.png', 'SwimmerSplashSurface.png', (512, 256)),
]:
    image = Image.open(ROOT / 'art/swimmer-water-v2' / source)
    assert image.mode == 'RGBA' and image.getchannel('A').getextrema()[0] == 0
    image.resize(size, Image.Resampling.LANCZOS).save(ROOT / 'assets/race/pool' / target, optimize=True)
    print(target, size)
