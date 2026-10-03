"""C1 定时水球；仅在独立后台 Blender 中构建，输出留在专属源目录。"""
from pathlib import Path
import bpy
import bmesh
import math
import json
import sys

SOURCE = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE))
from paint_warning import build_warning_texture


def material():
    mat = bpy.data.materials.new('WaterBalloonRubber')
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .38
    shader.inputs['Metallic'].default_value = 0
    color = mat.node_tree.nodes.new('ShaderNodeTexImage')
    color.image = build_warning_texture(SOURCE)
    mat.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])
    return mat


def mesh_object(name, vertices, faces, colors, mat, parent):
    mesh = bpy.data.meshes.new(name + 'Mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    assert all(e.is_manifold for e in bm.edges), name + ' 必须封闭'
    bm.to_mesh(mesh); bm.free()
    attr = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    mesh.color_attributes.active_color = attr
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop in polygon.loop_indices:
            attr.data[loop].color_srgb = colors[polygon.index]
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def lathe(rings, count=24):
    vertices, faces, colors = [], [], []
    for z, radius in rings:
        for i in range(count):
            angle = math.tau * i / count
            vertices.append((radius * math.cos(angle), radius * math.sin(angle) * .92, z - .14))
    for j in range(len(rings) - 1):
        for i in range(count):
            faces.append((j*count+i, j*count+(i+1)%count, (j+1)*count+(i+1)%count, (j+1)*count+i))
            # 三条宽黄瓣沿水滴纵向延伸，小尺寸仍清楚。
            colors.append((1, .76, .055, 1) if i % 8 < 3 else (1, .245, .025, 1))
    faces.extend([tuple(reversed(range(count))), tuple((len(rings)-1)*count+i for i in range(count))])
    colors.extend([(1, .54, .02, 1)]*2)
    return vertices, faces, colors


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    root = bpy.data.objects.new('TimedWaterBalloon', None)
    bpy.context.scene.collection.objects.link(root)
    mat = material()
    # 身体、扎口由同一连续环带拓扑形成，扎口底面与软连接件重叠 0.012m。
    rings = [(.128,.028),(.145,.045),(.159,.024),(.18,.028),(.211,.045),
             (.26,.106),(.32,.154),(.385,.18),(.447,.173),(.502,.143),(.55,.096),(.576,.038),(.58,.008)]
    body = mesh_object('BalloonBody', *lathe(rings), mat, root)
    body.location.z = .14
    uv = body.data.uv_layers.new(name='WarningUV')
    for face in body.data.polygons:
        segments = [body.data.loops[i].vertex_index % 24 for i in face.loop_indices]
        seam = min(segments) == 0 and max(segments) == 23
        for loop in face.loop_indices:
            index = body.data.loops[loop].vertex_index
            u = (index % 24) / 24
            if seam and u == 0: u = 1
            uv.data[loop].uv = (u, (rings[index // 24][0] - .128) / .452)
    # 图案已经包含橙黄底色，导出顶点色保持白色以免乘暗印花。
    for color in body.data.color_attributes['Color'].data: color.color_srgb = (1,1,1,1)
    vertices, faces, colors = [], [], []
    centers = [(0,0,0),(.012,0,.035),(.022,0,.075),(.012,0,.112),(0,0,.14)]
    for x,y,z in centers:
        for i in range(8):
            a=math.tau*i/8
            vertices.append((x+.013*math.cos(a),y+.013*math.sin(a),z))
    for j in range(4):
        for i in range(8):
            faces.append((j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i));colors.append((1,.72,.035,1))
    faces.extend([tuple(reversed(range(8))),tuple(32+i for i in range(8))]);colors.extend([(1,.72,.035,1)]*2)
    connector=mesh_object('BalloonConnector',vertices,faces,colors,mat,root)
    uv = connector.data.uv_layers.new(name='WarningUV')
    for loop in uv.data: loop.uv = (.5,.03)
    for color in connector.data.color_attributes['Color'].data: color.color_srgb = (1,1,1,1)
    objects=[body,connector]
    for obj in objects: obj.select_set(True)
    root.select_set(True)
    bpy.context.view_layer.objects.active=body
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'TimedWaterBalloon.blend'))
    bpy.ops.export_scene.gltf(filepath=str(SOURCE/'TimedWaterBalloon.glb'),export_format='GLB',
        use_selection=True,export_materials='EXPORT',export_vertex_color='ACTIVE',export_yup=True)
    for obj in objects: obj.data.calc_loop_triangles()
    report={'meshes':2,'materials':1,'textures':1,'textureSize':[512,512],
        'triangles':sum(len(o.data.loop_triangles) for o in objects),
        'bodyWidth':.36,'bodyDepth':.3312,'height':.58,'connectorLength':.14,
        'bodyPivotY':.14,'inflationRange':[1,1.51], 'connectorKnotOverlap':.012,
        'nodes':['TimedWaterBalloon','BalloonBody','BalloonConnector'],
        'bytes':(SOURCE/'TimedWaterBalloon.glb').stat().st_size}
    (SOURCE/'asset-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__': main()
