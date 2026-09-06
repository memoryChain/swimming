"""创作线性灯与屋盖支架，定向同步为一个无贴图的静态顶点色批次。"""
import json
import math
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
OUTPUT = ROOT / 'temp/ceiling-preview'
PREFIX = 'ceiling_premium_'
TARGET = 'ceiling_lighting_rig'
COLOR = 'CeilingColor'
MATERIAL = 'CeilingArchitecturalVertexColor'
VERSION = 1
BEAM_X = [-12.0 + 11.0 * i for i in range(7)]
RAIL_Y = [-9.0, -3.0, 3.0, 9.0]
RAIL_Z = 11.5

def linear(rgb):
    return tuple(v/255/12.92 if v/255 <= .04045 else ((v/255+.055)/1.055)**2.4 for v in rgb)

PALETTE = {
    'roof': linear((19, 28, 39)),
    'rib': linear((56, 75, 92)),
    'edge': linear((95, 117, 133)),
    'housing': linear((72, 93, 108)),
    'trim': linear((138, 161, 173)),
    'diffuser': linear((234, 246, 252)),
    'suspension': linear((94, 112, 124)),
}

def bounds(obj):
    points = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
    return [[min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]]

def material():
    mat = bpy.data.materials.get(MATERIAL) or bpy.data.materials.new(MATERIAL)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    color = nodes.new('ShaderNodeVertexColor')
    color.layer_name = COLOR
    mat.node_tree.links.new(color.outputs['Color'], emission.inputs['Color'])
    mat.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
    mat.diffuse_color = (1, 1, 1, 1)
    return mat

class Builder:
    def __init__(self, name, collection, mat):
        self.name, self.collection, self.mat = name, collection, mat
        self.vertices, self.faces, self.tones = [], [], []

    def extrude(self, profile, start, end, tone, x_axis=True, side_tones=None):
        # 同一截面沿 X 或 Y 延展；凹形灯壳有真正的槽口，不用贴片遮挡伪造。
        base = len(self.vertices)
        count = len(profile)
        for along in (start, end):
            for across, height in profile:
                self.vertices.append((along, across, height) if x_axis else (across, along, height))
        self.faces.extend([tuple(base + i for i in reversed(range(count))), tuple(base + count + i for i in range(count))])
        self.tones.extend([tone, tone])
        for i in range(count):
            j = (i + 1) % count
            self.faces.append((base+i, base+j, base+count+j, base+count+i))
            self.tones.append(side_tones.get(i,tone) if side_tones else tone)

    def tapered_roof(self, path, inner_x, outer_x, outer_half_y, tone):
        base=len(self.vertices)
        profile=[(y,z+.18) for y,z in path]+[(y,z+.30) for y,z in reversed(path)]
        count=len(profile)
        for x,scale in [(inner_x,1),(outer_x,outer_half_y/max(abs(path[0][0]),abs(path[-1][0])))]:
            self.vertices.extend((x,y*scale,z) for y,z in profile)
        self.faces.extend([tuple(base+i for i in reversed(range(count))),tuple(base+count+i for i in range(count))])
        self.tones.extend([tone,tone])
        for i in range(count):
            j=(i+1)%count
            self.faces.append((base+i,base+j,base+count+j,base+count+i));self.tones.append(tone)

    def box(self, lo, hi, tone):
        self.extrude([(lo[1], lo[2]), (hi[1], lo[2]), (hi[1], hi[2]), (lo[1], hi[2])], lo[0], hi[0], tone)

    def finish(self):
        mesh = bpy.data.meshes.new(self.name + '_Mesh')
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.materials.append(self.mat)
        mesh.update()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        attr = mesh.color_attributes.new(name=COLOR, type='FLOAT_COLOR', domain='CORNER')
        for polygon, tone in zip(mesh.polygons, self.tones):
            # 主视角看底面：底面保留颜色，顶与侧采用有限明暗档。
            shade = 1 if tone == 'diffuser' or polygon.normal.z < -.4 else .70 if polygon.normal.z > .4 else .84
            rgba = (*[c * shade for c in PALETTE[tone]], 1)
            for index in polygon.loop_indices:
                attr.data[index].color = rgba
        mesh.color_attributes.active_color_index = 0
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        self.collection.objects.link(obj)
        obj['ceiling_lighting_version'] = VERSION
        return obj

def build():
    assert Path(bpy.data.filepath).resolve() == SOURCE
    for obj in list(bpy.data.objects):
        if obj.name.startswith(PREFIX):
            old_mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if old_mesh.users == 0:
                bpy.data.meshes.remove(old_mesh)
    collection = bpy.data.collections.get('CeilingPremiumLighting') or bpy.data.collections.new('CeilingPremiumLighting')
    if collection.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(collection)
    mat = material()
    north, south = bounds(bpy.data.objects['StandBackWall_N']), bounds(bpy.data.objects['StandBackWall_S'])
    wall_y = [(south[0][1] + south[1][1]) / 2, (north[0][1] + north[1][1]) / 2]
    wall_z = min(north[1][2], south[1][2])
    # 横向浅拱肋由两侧后墙承托；连续截面保证折点处没有重复封盖或缝隙。
    path = [(wall_y[0], wall_z + .18), (-18, 12.7), (0, 13.5), (18, 12.7), (wall_y[1], wall_z + .18)]
    rib_profile = [(y, z - .18) for y, z in path] + [(y, z + .18) for y, z in reversed(path)]
    def roof_height(y):
        for a, b in zip(path, path[1:]):
            if a[0] <= y <= b[0]:
                return a[1] + (b[1]-a[1]) * (y-a[0])/(b[0]-a[0])
        raise ValueError(y)
    made, contacts = [], []
    prototype = '--prototype' in sys.argv
    xs = BEAM_X[:2] if prototype else BEAM_X
    rail_rows = RAIL_Y[:1] if prototype else RAIL_Y
    for i, x in enumerate(xs):
        b = Builder(f'{PREFIX}rib_{i:02}', collection, mat)
        b.extrude(rib_profile, x-.24, x+.24, 'rib')
        # 柱脚落在原后墙顶面，覆盖墙宽；屋架下缘同高。
        for y in wall_y:
            b.box((x-.36, y-.15, wall_z), (x+.36, y+.15, wall_z+.14), 'edge')
        made.append(b.finish())
        contacts.append({'interface': '屋架端部/后墙', 'x': x, 'gap': 0})
    if not prototype:
        # 深色屋盖是薄实体，底面与拱肋上沿接触；低对比保持泳池为主体。
        roof = Builder(PREFIX+'roof_shell', collection, mat)
        roof.extrude([(y,z+.18) for y,z in path] + [(y,z+.30) for y,z in reversed(path)],
                     max(south[0][0], north[0][0]), min(south[1][0], north[1][0]), 'roof')
        # 两端按原场馆切角收口，拱形封板下沿落在东西后墙顶面。
        for side,inner in [('W',max(south[0][0],north[0][0])),('E',min(south[1][0],north[1][0]))]:
            wall=bounds(bpy.data.objects['StandBackWall_'+side]);end_x=(wall[0][0]+wall[1][0])/2
            half_y=min(abs(wall[0][1]),abs(wall[1][1]))
            roof.tapered_roof(path,inner,end_x,half_y,'roof')
            scale=half_y/max(abs(path[0][0]),abs(path[-1][0]))
            end_profile=[(-half_y,wall[1][2]),(half_y,wall[1][2])]+[(y*scale,z+.30) for y,z in reversed(path)]
            roof.extrude(end_profile,end_x-.075,end_x+.075,'roof')
        made.append(roof.finish())
    for row, y in enumerate(rail_rows):
        b = Builder(f'{PREFIX}linear_rail_{row:02}', collection, mat)
        # 灯体宽 0.96m、高 0.28m；底部双扩散面内嵌 0.03m。
        section = [(-.48,-.14),(-.32,-.14),(-.32,0),(.32,0),(.32,-.14),(.48,-.14),(.48,.14),(-.48,.14)]
        b.extrude([(y+dy,RAIL_Z+dz) for dy,dz in section], xs[0]-.24, xs[-1]+.24, 'housing',side_tones={0:'trim',4:'trim'})
        # 灯槽中央脊与外侧窄金属唇，均与主灯壳实体接触。
        b.box((xs[0]-.24,y-.05,RAIL_Z-.11), (xs[-1]+.24,y+.05,RAIL_Z+.015), 'housing')
        for a, end in zip(xs,xs[1:]):
            for lo, hi in [(-.30,-.055),(.055,.30)]:
                # 顶面嵌入槽底 0.01m，扩散面与灯体无悬空缝。
                b.box((a+.48,y+lo,RAIL_Z-.11),(end-.48,y+hi,RAIL_Z+.01),'diffuser')
                contacts.append({'interface':'扩散板/槽底','overlap':.01,'row':row})
        for x in xs:
            # 双吊杆从灯壳顶面接到横向拱肋底面，无逐帧骨骼或摆动。
            for offset in (-.28,.28):
                lower = RAIL_Z+.14
                upper = roof_height(y+offset)-.18
                b.box((x-.045,y+offset-.045,lower),(x+.045,y+offset+.045,upper+.004),'suspension')
                assert upper > lower
                contacts.append({'interface':'吊杆/灯壳','gap':0,'row':row})
            b.box((x-.16,y-.46,RAIL_Z+.13),(x+.16,y+.46,RAIL_Z+.19),'edge')
        made.append(b.finish())
    bpy.context.view_layer.update()
    triangles = sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in made)
    assert triangles < 2400, triangles
    assert all(len(obj.data.materials)==1 for obj in made)
    assert all(obj.data.users==1 for obj in made)
    # 原墙顶、连续拱肋和屋盖的数学接触面由同一条截面线推导。
    assert abs(path[0][1]-.18-wall_z)<1e-6 and abs(path[-1][1]-.18-wall_z)<1e-6
    report={'objects':len(made),'triangles':triangles,'wallTop':wall_z,'railBottom':RAIL_Z-.14,
            'bounds':{obj.name:bounds(obj) for obj in made},'contacts':contacts}
    OUTPUT.mkdir(parents=True,exist_ok=True)
    (OUTPUT/('prototype-report.json' if prototype else 'author-report.json')).write_text(json.dumps(report,indent=2))
    print({'objects':len(made),'triangles':triangles,'prototype':prototype})
    if '--preview' in sys.argv or prototype:
        bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/('prototype.blend' if prototype else 'candidate.blend')))
    else:
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))

def sync():
    assert Path(bpy.data.filepath).resolve()==MASTER
    with bpy.data.libraries.load(str(SOURCE),link=False) as (available,data):
        data.objects=[name for name in available.objects if name.startswith(PREFIX)]
    assert len(data.objects)==12, len(data.objects)
    previous=bpy.data.objects.get(TARGET)
    if previous:
        old=previous.data
        bpy.data.objects.remove(previous,do_unlink=True)
        if old.users==0:bpy.data.meshes.remove(old)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in data.objects:
        bpy.context.scene.collection.objects.link(obj)
        obj.select_set(True)
    bpy.context.view_layer.objects.active=data.objects[0]
    bpy.context.view_layer.update()
    bpy.ops.object.join()
    obj=bpy.context.object
    obj.name=TARGET
    obj.data.name=TARGET+'_Mesh'
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    assert len(obj.data.materials)==1
    current_material=obj.data.materials[0]
    for mat in list(bpy.data.materials):
        if mat.name.startswith(MATERIAL) and mat != current_material and mat.users == 0:
            bpy.data.materials.remove(mat)
    current_material.name=MATERIAL
    obj['ceiling_lighting_version']=VERSION
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))

if __name__=='__main__':
    bpy.context.preferences.filepaths.save_version=0
    sync() if '--sync' in sys.argv else build()
