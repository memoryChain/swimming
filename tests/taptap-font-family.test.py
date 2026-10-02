import importlib.util
import io
import unittest
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tap_fonts", ROOT / "scripts/prepare-taptap-fonts.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TapFontFamilyTest(unittest.TestCase):
    def test_both_weights_keep_glyphs_and_have_distinct_host_names(self):
        families = []
        for filename, (expected, weight) in module.FACES.items():
            source = (ROOT / "assets/race/fonts" / filename).read_bytes()
            output, report = module.transform(source, filename)
            old = TTFont(io.BytesIO(source))
            new = TTFont(io.BytesIO(output))
            self.assertEqual(old.getBestCmap(), new.getBestCmap())
            self.assertEqual(new["OS/2"].usWeightClass, weight)
            self.assertEqual(old.reader["glyf"], new.reader["glyf"])
            self.assertEqual(new["name"].getDebugName(1), expected)
            self.assertEqual(new["name"].getDebugName(16), expected)
            self.assertTrue(report["glyph_tables_unchanged"])
            self.assertEqual(module.transform(output, filename)[0], output)
            families.append(expected)
        self.assertEqual(len(set(families)), 2)

    def test_wrong_weight_and_source_directory_are_rejected(self):
        source = (ROOT / "assets/race/fonts/ShuiMasterUI-Regular.ttf").read_bytes()
        with self.assertRaisesRegex(ValueError, "字重"):
            module.transform(source, "ShuiMasterUI-SemiBold.ttf")
        with self.assertRaisesRegex(ValueError, "build"):
            module.prepare(ROOT / "assets")


if __name__ == "__main__":
    unittest.main()
