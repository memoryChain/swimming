import importlib.util
import io
from pathlib import Path
import struct
import sys
import tempfile
import unittest

from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('ui_image_optimizer', ROOT / 'scripts/optimize-ui-images.py')
OPT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = OPT
SPEC.loader.exec_module(OPT)


class LosslessUiImages(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_rgba_pixels_color_orientation_and_aspect_chunks_survive(self):
        image = Image.new('RGBA', (32, 32))
        image.putdata([(x * 7, y * 7, 127, (x + y) * 4) for y in range(32) for x in range(32)])
        metadata = PngImagePlugin.PngInfo()
        metadata.add(b'sRGB', b'\x00')
        metadata.add(b'gAMA', struct.pack('>I', 45455))
        metadata.add(b'cHRM', struct.pack('>8I', 31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000))
        metadata.add_itxt('Description', '测试导出注释' * 300)
        exif = Image.Exif()
        exif[274] = 1
        source = self.root / 'image.png'
        image.save(source, pnginfo=metadata, exif=exif, dpi=(72, 144), compress_level=0)
        original = source.read_bytes()
        encoded, _ = OPT.png_candidate(OPT.inspect_image(self.root, source))
        self.assertLess(len(encoded), len(original))
        self.assertEqual(source.read_bytes(), original)
        with Image.open(io.BytesIO(encoded)) as decoded:
            self.assertEqual(decoded.size, image.size)
            self.assertEqual(decoded.convert('RGBA').tobytes(), image.tobytes())
        keep = lambda data: [(kind, raw) for kind, raw in OPT.png_chunks(data)
                             if kind not in OPT.PNG_DATA_CHUNKS | OPT.PNG_TEXT_CHUNKS]
        self.assertEqual(keep(encoded), keep(original))
        self.assertIn(b'sRGB', dict(keep(encoded)))
        self.assertIn(b'eXIf', dict(keep(encoded)))
        self.assertIn(b'pHYs', dict(keep(encoded)))

    def test_icc_profile_is_preserved_byte_for_byte(self):
        source = self.root / 'profile.png'
        Image.new('RGB', (32, 32), (12, 45, 78)).save(source, icc_profile=b'profile fixture', compress_level=0)
        original = source.read_bytes()
        encoded, _ = OPT.png_candidate(OPT.inspect_image(self.root, source))
        self.assertEqual(dict(OPT.png_chunks(encoded))[b'iCCP'], dict(OPT.png_chunks(original))[b'iCCP'])

    def test_indexed_transparency_keeps_rendered_pixels(self):
        source = self.root / 'palette.png'
        image = Image.new('P', (32, 32), 1)
        image.putpalette([255, 0, 0, 0, 255, 0] + [0] * 762)
        image.save(source, transparency=bytes([0, 127]), compress_level=0)
        encoded, _ = OPT.png_candidate(OPT.inspect_image(self.root, source))
        with Image.open(source) as before, Image.open(io.BytesIO(encoded)) as after:
            self.assertEqual(before.convert('RGBA').tobytes(), after.convert('RGBA').tobytes())

    def test_jpeg_is_untouched_by_default(self):
        source = self.root / 'background.jpg'
        Image.new('RGB', (32, 32), (23, 78, 156)).save(source, quality=95)
        original = source.read_bytes()
        candidate, reason = OPT.build_candidate(OPT.inspect_image(self.root, source), 82, 0, 0)
        self.assertIsNone(candidate)
        self.assertIn('JPG 保持原文件', reason)
        self.assertEqual(source.read_bytes(), original)

    def test_high_precision_and_animated_png_are_untouched(self):
        high = self.root / 'high.png'
        Image.new('I;16', (8, 8), 32768).save(high)
        animated = self.root / 'animated.png'
        Image.new('RGBA', (8, 8), 'red').save(animated, save_all=True,
            append_images=[Image.new('RGBA', (8, 8), 'blue')], duration=100, loop=0)
        for source in (high, animated):
            encoded, _ = OPT.png_candidate(OPT.inspect_image(self.root, source))
            self.assertEqual(encoded, source.read_bytes())

    def test_truncated_png_is_rejected(self):
        source = self.root / 'image.png'
        Image.new('RGB', (8, 8)).save(source)
        with self.assertRaises(ValueError):
            OPT.png_chunks(source.read_bytes()[:-3])


if __name__ == '__main__':
    unittest.main()
