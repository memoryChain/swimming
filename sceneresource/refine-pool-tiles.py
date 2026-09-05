"""烘焙规则卡通瓷砖色板并定向同步池底/池壁；原材质和图片名称保持稳定。"""
from pathlib import Path
import struct
import sys
import zlib

import bpy

ROOT = Path(__file__).resolve().parents[1]
EDITABLE = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
OBJECTS = ('pool_floor', 'pool_inner_wall_batch')
IMAGE = 'PoolWallNarrowTilesWhite'


def author():
    assert Path(bpy.data.filepath).resolve() == EDITABLE
    # 一张 256² 不透明纹理包含 4×4 规则方砖；64px/砖，接缝仅 1px。
    # 极轻的边缘明暗负责陶瓷质感，不添加噪声、法线贴图或实时灯光。
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))
    rows = []
    for y in range(256):
        row = bytearray([0])
        for x in range(256):
            u, v = x % 64, y % 64
            shift = ((x//64 + 2*(y//64)) % 3)-1
            rgb = (240+shift, 246+shift, 248+shift)
            if u == 0 or v == 0:
                rgb = (194, 217, 227)
            elif u == 1 or v == 1:
                rgb = (250, 253, 254)
            elif u == 63 or v == 63:
                rgb = (219, 235, 241)
            row.extend(rgb)
        rows.append(bytes(row))
    png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',256,256,8,2,0,0,0))
    png += chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
    path = ROOT / 'temp/venue-audit/PoolWallCartoonTiles.png'
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(png)
    previous = bpy.data.images[IMAGE]
    image = bpy.data.images.load(str(path),check_existing=False)
    image.pack()
    for material in bpy.data.materials:
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image == previous:
                    node.image = image
    bpy.data.images.remove(previous)
    image.name = IMAGE
    image.filepath = '//PoolWallCartoonTiles.png'
    for name in OBJECTS:
        obj = bpy.data.objects[name]
        if not obj.get('cartoon_pool_tiles_version'):
            # 原 UV 为 2.5m/重复；调整为 2m/重复，对应 0.5m 方砖。
            for loop in obj.data.uv_layers.active.data:
                loop.uv *= 1.25
        obj['cartoon_pool_tiles_version'] = 1
    bpy.ops.wm.save_as_mainfile(filepath=str(EDITABLE))


def sync():
    assert Path(bpy.data.filepath).resolve() == MASTER
    with bpy.data.libraries.load(str(EDITABLE), link=False) as (_, data):
        data.objects = list(OBJECTS)
    original_image = bpy.data.images.get(IMAGE)
    replacement = None
    for name, source in zip(OBJECTS, data.objects):
        bpy.context.scene.collection.objects.link(source)
        bpy.context.view_layer.update()
        target = bpy.data.objects[name]
        assert len(source.data.vertices) == len(target.data.vertices)
        assert max((source.matrix_world@a.co-target.matrix_world@b.co).length
                   for a,b in zip(source.data.vertices,target.data.vertices)) < 1e-5
        for a,b in zip(source.data.uv_layers.active.data,target.data.uv_layers.active.data):
            b.uv = a.uv
        for source_mat in source.data.materials:
            if not source_mat or not source_mat.use_nodes:
                continue
            for source_node in source_mat.node_tree.nodes:
                if source_node.type == 'TEX_IMAGE' and source_node.image and source_node.image.name.startswith(IMAGE):
                    replacement = source_node.image
        target['cartoon_pool_tiles_version'] = 1
        bpy.data.objects.remove(source,do_unlink=True)
    assert replacement and original_image
    for material in bpy.data.materials:
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image == original_image:
                    node.image = replacement
    bpy.data.images.remove(original_image)
    replacement.name = IMAGE
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))


if __name__ == '__main__':
    sync() if '--sync' in sys.argv else author()
