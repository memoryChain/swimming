"""制作 B1 共用浮圈。通过 scripts/run-blender.py 执行。"""
from pathlib import Path
import math
import json
import struct
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent
OUTPUT = ROOT / 'assets/race/items/RecoveryFloatRing.glb'


def main():
    # 独立后台场景，不读取或覆盖用户打开的文件。
    bpy.ops.wm.read_factory_settings(use_empty=True)
    vertices, faces = [], []
    segments, cross = 32, 10
    # 主半径 1、管半径 .24；运行时按真实肩宽与前臂弦长统一缩放。
    for i in range(segments):
        a = i * math.tau / segments
        for j in range(cross):
            b = j * math.tau / cross
            radius = 1 + .24 * math.cos(b)
            vertices.append((radius * math.cos(a), radius * math.sin(a), .24 * math.sin(b)))
    for i in range(segments):
        for j in range(cross):
            faces.append((i*cross+j, ((i+1)%segments)*cross+j,
                          ((i+1)%segments)*cross+(j+1)%cross, i*cross+(j+1)%cross))
    mesh = bpy.data.meshes.new('RecoveryFloatRingMesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    assert all(e.is_manifold for e in bm.edges), '浮圈必须闭合连续'
    bm.to_mesh(mesh); bm.free()
    colors = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    mesh.color_attributes.active_color = colors
    for face in mesh.polygons:
        stripe = (face.index // cross) % 8 in (0, 1)
        rgb = (1, .94, .76) if stripe else (1, .32, .055)
        shade = .72 + .28 * max(0, face.normal.z)
        for loop in face.loop_indices:
            colors.data[loop].color_srgb = (*[v*shade for v in rgb], 1)
    material = bpy.data.materials.new('RecoveryFloatRingColor')
    material.use_nodes = True
    nodes = material.node_tree.nodes; nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    color = nodes.new('ShaderNodeVertexColor'); color.layer_name = 'Color'
    material.node_tree.links.new(color.outputs['Color'], emission.inputs['Color'])
    material.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
    mesh.materials.append(material)
    obj = bpy.data.objects.new('RecoveryFloatRing', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    mesh.calc_loop_triangles()
    assert len(mesh.loop_triangles) == 640
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'RecoveryFloatRing.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True,
                             export_materials='EXPORT', export_vertex_color='ACTIVE',
                             export_all_vertex_colors=True, export_yup=True)
    # Blender 的顶点色 Emission 不会自动导成 glTF unlit；显式规范化材质。
    # 只调整材质语义，保留导出的顶点色和二进制网格不变。
    raw=OUTPUT.read_bytes(); json_size=struct.unpack_from('<I',raw,12)[0]
    gltf=json.loads(raw[20:20+json_size])
    gltf['materials']=[{'name':'RecoveryFloatRingColor', 'pbrMetallicRoughness':{
        'baseColorFactor':[1,1,1,1], 'metallicFactor':0, 'roughnessFactor':1},
        'extensions':{'KHR_materials_unlit':{}}}]
    gltf['extensionsUsed']=['KHR_materials_unlit']
    payload=json.dumps(gltf,separators=(',',':')).encode('utf-8')
    payload+=b' '*((-len(payload))%4)
    binary=raw[20+json_size:]
    OUTPUT.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(binary))
        +struct.pack('<II',len(payload),0x4e4f534a)+payload+binary)
    report = {'triangles':640, 'meshes':1, 'materials':1, 'textures':0,
              'majorRadius':1, 'tubeRadius':.24, 'innerDiameter':1.52,
              'outerDiameter':2.48, 'bytes':OUTPUT.stat().st_size}
    (SOURCE / 'asset-audit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
