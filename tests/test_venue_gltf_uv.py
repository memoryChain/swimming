import copy
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('venue_gltf_uv', ROOT/'sceneresource/venue_gltf_uv.py')
uv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uv)


def document(index=-1, attributes=None):
    return {'materials': [{'name': '广告', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0, 'texCoord': index}},
                           'emissiveTexture': {'index': 0, 'texCoord': index}}],
            'meshes': [{'primitives': [{'material': 0, 'attributes': attributes or {'POSITION': 0, 'TEXCOORD_0': 1}}]}]}


class VenueUvTests(unittest.TestCase):
    def test_single_uv_repair(self):
        source = document()
        with self.assertRaises(ValueError): uv.validate_texture_uvs(source)
        self.assertEqual(uv.validate_texture_uvs(source, True), 2)
        self.assertEqual(uv.validate_texture_uvs(source), 0)
        self.assertEqual(source, document(0))

    def test_valid_second_uv_preserved(self):
        source = document(1, {'TEXCOORD_0': 0, 'TEXCOORD_1': 1})
        before = copy.deepcopy(source)
        self.assertEqual(uv.validate_texture_uvs(source, True), 0)
        self.assertEqual(source, before)

    def test_ambiguous_missing_and_shared_uv_rejected(self):
        for source in [document(-1, {'TEXCOORD_0': 0, 'TEXCOORD_1': 1}), document(1), document(-1, {'POSITION': 0})]:
            with self.assertRaises(ValueError): uv.validate_texture_uvs(source, True)
        source = document()
        source['meshes'][0]['primitives'].append({'material': 0, 'attributes': {'TEXCOORD_1': 1}})
        before = copy.deepcopy(source)
        with self.assertRaises(ValueError): uv.validate_texture_uvs(source, True)
        self.assertEqual(source, before)

    def test_glb_keeps_binary_and_repair_is_idempotent(self):
        encoded = json.dumps(document(), ensure_ascii=False).encode()
        encoded += b' ' * (-len(encoded) % 4)
        tail = struct.pack('<II', 16, 0x004E4942) + bytes(range(16))
        data = struct.pack('<IIIII', 0x46546C67, 2, 20+len(encoded)+len(tail), len(encoded), 0x4E4F534A)+encoded+tail
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'venue.glb'
            path.write_bytes(data)
            self.assertEqual(uv.check_glb(path, True), 2)
            fixed = path.read_bytes()
            self.assertTrue(fixed.endswith(tail))
            self.assertEqual(uv.check_glb(path, True), 0)
            self.assertEqual(path.read_bytes(), fixed)

    def test_runtime_venue_has_valid_uvs(self):
        self.assertEqual(uv.check_glb(ROOT/'assets/race/pool/LowPolyPool.glb'), 0)


if __name__ == '__main__':
    unittest.main()
