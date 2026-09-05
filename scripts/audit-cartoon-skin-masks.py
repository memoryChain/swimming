"""用独立后台 Blender 保存卡通角色原始快照和世界坐标 UV 审计。

blender -b --python scripts/audit-cartoon-skin-masks.py -- --workdir tools/characters/skin-audit
"""
import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

import bpy
import numpy as np


def audit(work):
    if not bpy.app.background:
        raise RuntimeError('此脚本只允许在独立后台 Blender 执行，以保护正在编辑的场景。')
    root = Path(__file__).resolve().parents[1]
    for number in (5, 6, 8, 9, 10, 11, 12):
        name = f'CartonSwimmer{number}'
        folder = work / name
        folder.mkdir(parents=True, exist_ok=True)
        # 旧快照绝不覆盖；后续修复始终以同一份原始遮罩为依据。
        for suffix in ('.glb', 'ColorMask.png', '.glb.meta', 'ColorMask.png.meta'):
            destination = folder / (name + suffix)
            if not destination.exists():
                shutil.copy2(root / 'assets/race/models' / destination.name, destination)
        data = (folder / (name + '.glb')).read_bytes()
        size = struct.unpack_from('<I', data, 12)[0]
        document = json.loads(data[20:20 + size])
        binary = data[28 + size:]
        material = document['materials'][0]['pbrMetallicRoughness']
        texture = document['textures'][material['baseColorTexture']['index']]
        image = document['images'][texture['source']]
        view = document['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset', 0)
        suffix = '.png' if image['mimeType'] == 'image/png' else '.jpg'
        (folder / ('base-source' + suffix)).write_bytes(binary[offset:offset + view['byteLength']])
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(folder / (name + '.glb')))
        # 导入器可能创建用于骨骼显示的 Icosphere；它不是运行时蒙皮网格。
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH'
                  and any(mod.type == 'ARMATURE' for mod in o.modifiers)]
        rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
        if len(meshes) != 1 or len(rigs) != 1 or len(meshes[0].data.materials) != 1:
            raise RuntimeError(f'{name} 的网格、材质或骨架结构已变化，需要重新检查。')
        mesh = meshes[0]
        mesh.data.calc_loop_triangles()
        uv = mesh.data.uv_layers.active.data
        np.savez(
            folder / 'geometry.npz',
            vertices=np.array([list(mesh.matrix_world @ v.co) for v in mesh.data.vertices]),
            triangles=np.array([list(t.vertices) for t in mesh.data.loop_triangles]),
            uv=np.array([[list(uv[loop].uv) for loop in t.loops] for t in mesh.data.loop_triangles]),
        )
        print(name, '顶点', len(mesh.data.vertices), '三角形', len(mesh.data.loop_triangles),
              '骨骼', len(rigs[0].data.bones), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='保存原始角色和肤色遮罩，不修改运行时资产。')
    parser.add_argument('--workdir', type=Path, required=True)
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    audit(parser.parse_args(arguments).workdir.resolve())
