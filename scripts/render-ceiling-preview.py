"""在后台 Blender 渲染灯具/场馆预览，不修改打开的 GUI 场景或保存源文件。"""
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'temp/ceiling-preview'
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=16
scene.cycles.use_denoising=True
scene.render.resolution_x=1440
scene.render.resolution_y=810
scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard'
scene.world=bpy.data.worlds.new('顶灯离线背景')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0,0,0,1)
cam=bpy.data.objects.new('离线展示相机',bpy.data.cameras.new('离线展示相机'))
scene.collection.objects.link(cam)
scene.camera=cam

def view(eye,target,fov=66,ortho=None):
    cam.location=eye
    cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO' if ortho else 'PERSP'
    if ortho:cam.data.ortho_scale=ortho
    cam.data.angle=math.radians(fov)

def render(name):
    scene.render.filepath=str(OUTPUT/f'{name}.png')
    bpy.ops.render.render(write_still=True)

if '--prototype' in sys.argv:
    for obj in scene.objects:
        if obj.type=='MESH':obj.hide_render=not obj.name.startswith('ceiling_premium_')
    view((-3,-15,8),(-6.5,-9,11.65),ortho=14)
    render('prototype-underside')
    # 同一模块六向检查；构件接触另由创作脚本的尺寸报告核对。
    center=Vector((-6.5,-9,11.8))
    for name,axis in [('front',(0,-1,0)),('back',(0,1,0)),('left',(-1,0,0)),('right',(1,0,0)),('top',(0,0,1)),('bottom',(0,.001,-1))]:
        view(center+Vector(axis)*20,center,ortho=14)
        render('prototype-'+name)
else:
    import importlib.util
    spec=importlib.util.spec_from_file_location('venue_export',ROOT/'sceneresource/export-flatcolor-venue-glb.py')
    exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)
    exporter.bake_vertex_shade(exporter.exportable_meshes())
    # 与导出流程一样烘焙分层亮度，仅在内存中给源材质乘顶点色供预览。
    # 正式运行时由 StandHeightShade 消费；预览不替代真实水面与后处理。
    for obj in scene.objects:
        if obj.type!='MESH':continue
        if 'ceiling' in obj.name.lower():continue
        attr=obj.data.color_attributes.get('venueShade')
        if not attr:continue
        for slot in obj.material_slots:
            mat=slot.material
            if not mat or not mat.use_nodes or mat.get('preview_shade'):continue
            nodes=mat.node_tree.nodes
            shader=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
            if not shader:continue
            for name in ['Base Color','Emission Color']:
                socket=shader.inputs.get(name)
                if not socket:continue
                mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
                if socket.links:mat.node_tree.links.new(socket.links[0].from_socket,mix.inputs[1])
                else:mix.inputs[1].default_value=socket.default_value
                color=nodes.new('ShaderNodeVertexColor');color.layer_name='venueShade'
                mat.node_tree.links.new(color.outputs['Color'],mix.inputs[2])
                mat.node_tree.links.new(mix.outputs[0],socket)
            mat['preview_shade']=True
    # 从实际观众生成器读取数据，让灯具与当前看台同框比较。
    crowd=ROOT/'temp/spectator-preview/after.json'
    if crowd.exists():
        mat=bpy.data.materials.new('离线观众顶点色');mat.use_nodes=True
        nodes=mat.node_tree.nodes;nodes.clear()
        color=nodes.new('ShaderNodeVertexColor');color.layer_name='Color'
        emission=nodes.new('ShaderNodeEmission');out=nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(color.outputs[0],emission.inputs[0]);mat.node_tree.links.new(emission.outputs[0],out.inputs[0])
        for i,g in enumerate(json.loads(crowd.read_text())['geometry']):
            p=g['positions'];idx=g['indices'];mesh=bpy.data.meshes.new(f'preview_crowd_{i}')
            mesh.from_pydata([(p[j],-p[j+2],p[j+1]) for j in range(0,len(p),3)],[],[idx[j:j+3] for j in range(0,len(idx),3)])
            mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT').data.foreach_set('color',g['colors'])
            mesh.materials.append(mat);obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj)
    # 用户图是水面以上、纵向拉远的镜头；同时核对折返方向与仰视。
    view((.5,0,2.5),(24,0,-.5),fov=72);render('arena-forward')
    view((49.5,0,2.5),(26,0,-.5),fov=72);render('arena-reverse')
    view((5,-7,2),(23,0,10),fov=72);render('arena-roof')
print('顶灯预览完成：',OUTPUT)
