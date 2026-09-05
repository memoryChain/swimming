"""确认新角色遮罩选项不会改变旧角色的默认行为。"""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location(
    'green_mask', Path(__file__).resolve().parents[1] / 'scripts/generate-green-recolor-mask.py')
mask_tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mask_tools)


class GreenMaskTests(unittest.TestCase):
    def test_lime_and_peach_orange_keep_orange_equipment_separate(self):
        self.assertEqual(mask_tools.green_weight(160, 186, 42, palette='lime'), 1.0)
        self.assertEqual(mask_tools.skin_weight(232, 173, 128, palette='peach-orange'), 1.0)
        for color in ((239, 151, 28), (160, 90, 14), (30, 40, 70), (240, 240, 240)):
            self.assertEqual(mask_tools.green_weight(*color, palette='lime'), 0.0)
            self.assertEqual(mask_tools.skin_weight(*color, palette='peach-orange'), 0.0)
        self.assertEqual(mask_tools.skin_weight(160, 186, 42, palette='peach-orange'), 0.0)

    def test_light_peach_excludes_brown_hair_and_pink_accessories(self):
        for color in ((120, 75, 48), (186, 129, 92), (245, 120, 170), (255, 255, 255)):
            self.assertEqual(mask_tools.skin_weight(*color, palette='light-peach'), 0.0)
        self.assertEqual(mask_tools.skin_weight(245, 180, 135, palette='light-peach'), 1.0)

    def test_palette_separates_green_skin_and_neutrals(self):
        self.assertEqual(mask_tools.green_weight(50, 220, 40), 1.0)
        self.assertEqual(mask_tools.green_weight(245, 180, 135), 0.0)
        self.assertEqual(mask_tools.skin_weight(245, 180, 135), 1.0)
        for color in ((255, 255, 255), (20, 20, 20), (50, 220, 40), (30, 40, 70)):
            self.assertEqual(mask_tools.skin_weight(*color), 0.0)

    def test_optional_closing_keeps_existing_default(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source = Image.new('RGB', (32, 32), (255, 255, 255))
            source.paste((50, 220, 40), (0, 0, 8, 32))
            source.paste((245, 180, 135), (10, 0, 24, 32))
            source.putpixel((16, 16), (255, 255, 255))
            source.save(folder / 'source.png')
            for name, radius in (('default', None), ('legacy', 2), ('precise', 0)):
                args = () if radius is None else (radius,)
                mask_tools.build_mask(folder / 'source.png', folder / f'{name}.png', *args)
            with Image.open(folder / 'default.png') as default, Image.open(folder / 'legacy.png') as legacy, Image.open(folder / 'precise.png') as precise:
                self.assertEqual(default.tobytes(), legacy.tobytes())
                self.assertEqual(default.getpixel((16, 16))[2], 255)
                self.assertEqual(precise.getpixel((16, 16)), (0, 0, 0, 255))
                self.assertEqual(precise.getchannel('G').getextrema(), (0, 0))

    def test_component_filter_removes_flecks_and_solidifies_kept_blocks(self):
        plane = Image.new('L', (24, 24), 0)
        for y in range(6, 14):
            for x in range(6, 14):
                plane.putpixel((x, y), 96)
        plane.putpixel((20, 20), 255)
        removed_components, removed_pixels = mask_tools.remove_small_garment_components(plane, 8)
        self.assertEqual((removed_components, removed_pixels), (1, 1))
        self.assertEqual(plane.getpixel((20, 20)), 0)
        self.assertGreater(plane.getpixel((9, 9)), 0)

        mask_tools.solidify_garment_components(plane)
        self.assertEqual(plane.getpixel((9, 9)), 255)
        self.assertEqual(plane.getpixel((20, 20)), 0)


if __name__ == '__main__':
    unittest.main()
