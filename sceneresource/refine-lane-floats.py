"""生成八边连续绳体，以重复贴图表现密集盘片，全池不超过 4,000 triangles。"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
NAME = 'lane_float_rope_batch'
# Cocos 的 Mesh 子资源 UUID 取决于导出的数据名，替换几何也必须保持它。
RUNTIME_MESH_NAME = 'lane_float_rope_batch_Mesh.002'
LAYOUT = 'disc_float_source_layout'
RADIUS = 0.07
CENTER_ABOVE_WATER = 0.02
RIBS_PER_SEGMENT = 12
SIDES = 8


def source_layout(obj):
    if LAYOUT in obj:
        return json.loads(obj[LAYOUT])
    mesh = obj.data
    parent = list(range(len(mesh.vertices)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for edge in mesh.edges:
        a,b = edge.vertices
        parent[find(a)] = find(b)
    groups = {}
    for v in mesh.vertices:
        groups.setdefault(find(v.index), []).append(v.co.copy())
    layout = []
    for group,points in groups.items():
        xs = sorted(set(round(p.x,5) for p in points))
        center = [(min(p[k] for p in points)+max(p[k] for p in points))*.5 for k in (1,2)]
        materials = {}
        for face in mesh.polygons:
            if find(face.vertices[0]) != group:
                continue
            coords = [mesh.vertices[i].co.x for i in face.vertices]
            if max(coords)-min(coords) > .1:
                key = (round(min(coords),5),round(max(coords),5))
                if key in materials:
                    assert materials[key] == face.material_index
                materials[key] = face.material_index
        sections = [(a,b,materials[(a,b)]) for a,b in zip(xs,xs[1:])]
        layout.append({'y':center[0],'z':center[1],'sections':sections})
    assert len(layout) == 7
    assert all(len(r['sections']) == 34 for r in layout)
    return sorted(layout,key=lambda r:r['y'])


def build(obj, prototype=False):
    layout = source_layout(obj)
    vertices, faces, uvs, indices = [], [], [], []
    water = bpy.data.objects['PoolWaterSurface']
    water_z = max((water.matrix_world @ v.co).z for v in water.data.vertices)
    active = layout[3:4] if prototype else layout
    section_count = 0
    section_faces = []
    cap_pairs = []
    pitches = []
    for rope in active:
        center_world = obj.matrix_world @ Vector((0, rope['y'], rope['z']))
        center_world.z = water_z + CENTER_ABOVE_WATER
        center_z = (obj.matrix_world.inverted() @ center_world).z
        sections = rope['sections'][16:18] if prototype else rope['sections']
        start = len(vertices)
        # 只在颜色边界留截面环，整条绳体拓扑连通；移除逐颗封盖及内部细绳。
        for x in [section[0] for section in sections] + [sections[-1][1]]:
            for j in range(SIDES):
                angle = (j + .5) * math.tau / SIDES
                vertices.append((x, rope['y'] + RADIUS * math.sin(angle), center_z - RADIUS * math.cos(angle)))
        for i, (a, b, material) in enumerate(sections):
            assert b > a
            if i:
                assert abs(a - sections[i-1][1]) < 1e-5, '相邻色段必须共用同一截面，不能出现缝隙'
            pitches.append((b-a) / RIBS_PER_SEGMENT)
            for j in range(SIDES):
                k = (j+1) % SIDES
                section_faces.append((len(faces), (a+b)*.5, rope['y'], center_z))
                faces.append((start+i*SIDES+j, start+i*SIDES+k, start+(i+1)*SIDES+k, start+(i+1)*SIDES+j))
                # 每色段只需六/八个四边面，细密盘片由已有可重复纹理表现。
                # V 只承载圆周顶光，纹理各行相同，接缝顶点无需为 V=1 复制。
                uvs.append([(0,(j+.5)/SIDES), (0,(k+.5)/SIDES), (RIBS_PER_SEGMENT,(k+.5)/SIDES), (RIBS_PER_SEGMENT,(j+.5)/SIDES)])
                indices.append(material)
            section_count += 1
        back = len(faces)
        for end, order, material in ((0,list(reversed(range(SIDES))),sections[0][2]), (len(sections),list(range(SIDES)),sections[-1][2])):
            faces.append(tuple(start+end*SIDES+j for j in order))
            uvs.append([(0 if end == 0 else RIBS_PER_SEGMENT, (j+.5)/SIDES) for j in order])
            indices.append(material)
        cap_pairs.append((back, back+1, (sections[0][0]+sections[-1][1])*.5))
    mesh = bpy.data.meshes.new(NAME+'_TexturedRopes')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for material in obj.data.materials:
        material.use_backface_culling = True
        mesh.materials.append(material)
    uv = mesh.uv_layers.new(name='UVMap')
    for face, coords, material in zip(mesh.polygons, uvs, indices):
        face.material_index = material
        for loop, value in zip(face.loop_indices, coords):
            uv.data[loop].uv = value
        assert face.area > 0
    mesh.calc_loop_triangles()
    expected = section_count * 2 * SIDES + len(active) * 2 * (SIDES-2)
    assert len(mesh.loop_triangles) == expected
    assert prototype or expected <= 4000, '贴图浮漂全池不能超过 4,000 triangles'
    assert len(mesh.vertices) == (section_count + len(active)) * SIDES
    uses = {edge.key:0 for edge in mesh.edges}
    for face in mesh.polygons:
        for edge in face.edge_keys:
            uses[edge] += 1
    assert all(value == 2 for value in uses.values()), '每条绳体必须拓扑闭合'
    def samples(face, mid, reflect=False):
        values = []
        for loop in face.loop_indices:
            p = mesh.vertices[mesh.loops[loop].vertex_index].co
            u, v = uv.data[loop].uv
            values.append(((2*mid-p.x if reflect else p.x), p.y, p.z, (RIBS_PER_SEGMENT-u if reflect else u), v))
        return sorted(values)
    def mirrored_equal(a, b, mid):
        # Blender 顶点为 float32；用误差界而非十进制舍入判断，避免边界误报。
        left, right = samples(a,mid,True), samples(b,mid)
        return len(left) == len(right) and all(max(abs(x-y) for x,y in zip(p,q)) < 1e-5 for p,q in zip(left,right))
    for face_id, mid, y, z in section_faces:
        face = mesh.polygons[face_id]
        assert abs(face.normal.x) < 1e-5
        assert face.normal.y*(face.center.y-y) + face.normal.z*(face.center.z-z) > 0, '柱身法线必须朝外'
        assert mirrored_equal(face,face,mid), '每色段几何及 UV 必须前后对称'
    for back_id, front_id, mid in cap_pairs:
        back, front = mesh.polygons[back_id], mesh.polygons[front_id]
        assert front.normal.x > 0 and back.normal.x < 0
        assert mirrored_equal(front,back,mid), '两个端面必须镜像一致'
    old = obj.data
    obj.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)
    obj[LAYOUT] = json.dumps(layout,separators=(',',':'))
    obj['disc_float_version'] = 6
    # 此版本记录的是纹理盘节数量，不是独立几何颗数。
    obj['disc_float_count'] = section_count * RIBS_PER_SEGMENT
    print(json.dumps({'ropes':len(active), 'texturedRibs':section_count*RIBS_PER_SEGMENT, 'triangles':expected, 'vertices':len(mesh.vertices), 'materials':len(mesh.materials), 'diameter':RADIUS*2, 'ribPitchRange':[min(pitches),max(pitches)]}))


def sync():
    assert Path(bpy.data.filepath).resolve()==MASTER
    target=bpy.data.objects[NAME]
    old_materials=list(target.data.materials)
    with bpy.data.libraries.load(str(SOURCE),link=False) as (_,data):data.objects=[NAME]
    source=data.objects[0]
    bpy.context.scene.collection.objects.link(source)
    bpy.context.view_layer.update()
    assert source.get('disc_float_version')==6 and source.get('disc_float_count')==2856
    assert max(abs(source.matrix_world[i][j]-target.matrix_world[i][j]) for i in range(4) for j in range(4))<1e-5
    mesh=source.data.copy()
    for i,mat in enumerate(old_materials):
        mat.use_backface_culling=True
        mesh.materials[i]=mat
    old=target.data;target.data=mesh
    for key in (LAYOUT,'disc_float_version','disc_float_count'):target[key]=source[key]
    bpy.data.objects.remove(source,do_unlink=True)
    if old.users==0:bpy.data.meshes.remove(old)
    mesh.name=RUNTIME_MESH_NAME
    assert mesh.name==RUNTIME_MESH_NAME
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))


if __name__=='__main__':
    if '--sync' in sys.argv:sync()
    else:
        assert Path(bpy.data.filepath).resolve()==SOURCE
        build(bpy.data.objects[NAME],'--prototype' in sys.argv)
        if '--prototype' not in sys.argv:bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
