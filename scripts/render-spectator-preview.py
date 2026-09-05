"""离线渲染实际运行时代码导出的观众几何；不打开 Creator，不保存场馆源文件。"""
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'temp' / 'spectator-preview'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.cycles.use_denoising = False
scene.render.resolution_x = 1440
scene.render.resolution_y = 840
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('观众预览背景')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.075, 0.115, 0.16, 1)

material = bpy.data.materials.new('运行时无光照顶点色')
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
attribute = nodes.new('ShaderNodeVertexColor')
attribute.layer_name = 'Color'
emission = nodes.new('ShaderNodeEmission')
out = nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(attribute.outputs['Color'], emission.inputs['Color'])
material.node_tree.links.new(emission.outputs[0], out.inputs['Surface'])

def mesh_object(name, g):
    positions, colors, indices = g['positions'], g['colors'], g['indices']
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(positions[i], -positions[i+2], positions[i+1]) for i in range(0, len(positions), 3)], [],
                      [indices[i:i+3] for i in range(0, len(indices), 3)])
    attr = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
    attr.data.foreach_set('color', colors)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj

groups = {}
for version in ('before', 'after'):
    data = json.loads((OUTPUT / f'{version}.json').read_text())
    for kind in ('samples', 'geometry'):
        groups[version, kind] = [mesh_object(f'{version}_{kind}_{i}', g) for i, g in enumerate(data[kind])]
for objects in groups.values():
    for obj in objects:
        obj.hide_render = True

# 几何已经过索引、包围盒与退化面检查；此相机仅用于成品预览。
camera = bpy.data.objects.new('离线展示相机', bpy.data.cameras.new('离线展示相机'))
scene.collection.objects.link(camera)
scene.camera = camera
def view(eye, target, ortho=None, fov=50):
    import math
    camera.location = (eye[0], -eye[2], eye[1])
    look = Vector((target[0], -target[2], target[1]))
    camera.rotation_euler = (look - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO' if ortho else 'PERSP'
    if ortho:
        camera.data.ortho_scale = ortho
    camera.data.angle = math.radians(fov)

def render(name):
    scene.render.filepath = str(OUTPUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)

for version in ('before', 'after'):
    for obj in groups[version, 'samples']:
        obj.hide_render = False
    view((2.0, 1.25, -4), (1.35, .42, 0), ortho=3.85)
    render(f'{version}-samples')
    if version == 'after':
        # 同一人物的六向轮廓检查，避免前视图掩盖厚度与部件间隙。
        for obj in groups[version, 'samples'][1:]:
            obj.hide_render = True
        for label, eye in [('front', (0, .4, -4)), ('back', (0, .4, 4)), ('left', (-4, .4, 0)),
                           ('right', (4, .4, 0)), ('top', (0, 4, -.001)), ('bottom', (0, -4, -.001))]:
            view(eye, (0, .4, 0), ortho=2.0)
            render(f'check-{label}')
    for obj in groups[version, 'samples']:
        obj.hide_render = True

bpy.ops.import_scene.gltf(filepath=str(ROOT / 'assets/race/pool/LowPolyPool.glb'))
# 顶点色和场馆原无光照材质按标准显示变换显示；水面仍为 GLB 占位面。
for obj in scene.objects:
    if obj.type == 'MESH' and 'ceiling' in obj.name.lower():
        obj.hide_render = True

for version in ('before', 'after'):
    for obj in groups[version, 'geometry']:
        obj.hide_render = False
    # 池内低位正反跟拍，保持相同高度与视场；另给看台局部辨识预览。
    view((8, 1.2, -2), (28, 1.4, 1), fov=64)
    render(f'{version}-forward')
    view((42, 1.2, -2), (22, 1.4, 1), fov=64)
    render(f'{version}-reverse')
    view((12, 2, 7), (5, 1.8, 18.5), fov=40)
    render(f'{version}-stand')
    for obj in groups[version, 'geometry']:
        obj.hide_render = True
print('观众离线预览完成：', OUTPUT)
