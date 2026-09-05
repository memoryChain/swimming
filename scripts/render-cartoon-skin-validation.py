"""在独立后台 Blender 中审计和渲染，不切换正在编辑的场景。"""
import bpy, sys, json, argparse
import numpy as np
from pathlib import Path
from mathutils import Vector, Quaternion
if not bpy.app.background:
    raise RuntimeError('只允许在独立后台 Blender 中执行验证渲染。')
parser=argparse.ArgumentParser(description='验证原色、深肤色、五种装备颜色和两个动作。')
parser.add_argument('--workdir', type=Path, required=True)
parser.add_argument('--stage', choices=('before','after'), default='after')
parser.add_argument('--ids', nargs='+', type=int, default=[5,6,8,9,10,11,12])
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
WORK=args.workdir.resolve()
ROOT=Path(__file__).resolve().parents[1]
stage=args.stage
ids=args.ids
for i in ids:
    name=f'CartonSwimmer{i}'; folder=WORK/name
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(folder/(name+'.glb')))
    mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=4;scene.cycles.use_denoising=False
    scene.render.resolution_x=600;scene.render.resolution_y=660;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.world=bpy.data.worlds.new('验证背景');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0.055,0.065,0.082,1)
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    camera=bpy.data.objects.new('验证相机',bpy.data.cameras.new('验证相机'));scene.collection.objects.link(camera);scene.camera=camera
    camera.data.type='ORTHO';camera.data.ortho_scale=1.22
    material=bpy.data.materials.new('验证材质');material.use_nodes=True
    nodes=material.node_tree.nodes;nodes.clear();links=material.node_tree.links
    tex=nodes.new('ShaderNodeTexImage');tex.interpolation='Linear'
    emission=nodes.new('ShaderNodeEmission');output=nodes.new('ShaderNodeOutputMaterial')
    links.new(emission.outputs[0],output.inputs[0])
    # 对底图和遮罩分别做双线性采样，然后在线性空间执行实际换色公式。
    base_path=folder/'base.png'
    if not base_path.exists():base_path=next(folder.glob('base-source.*'))
    base_image=bpy.data.images.load(str(base_path))
    mask_image=bpy.data.images.load(str(folder/(name+'ColorMask.png' if stage=='before' else 'candidate.png')))
    mask_image.colorspace_settings.name='Non-Color'
    mask_node=nodes.new('ShaderNodeTexImage');mask_node.image=mask_image;mask_node.interpolation='Linear'
    separate=nodes.new('ShaderNodeSeparateColor');links.new(mask_node.outputs[0],separate.inputs[0])
    def math_node(op,left,right=None):
        node=nodes.new('ShaderNodeMath');node.operation=op
        for index,value in enumerate((left,right)):
            if value is None:continue
            if isinstance(value,(float,int)):node.inputs[index].default_value=value
            else:links.new(value,node.inputs[index])
        return node.outputs[0]
    dot=nodes.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';dot.inputs[1].default_value=(.2126,.7152,.0722)
    links.new(tex.outputs[0],dot.inputs[0])
    lum=math_node('MINIMUM',math_node('DIVIDE',dot.outputs['Value'],.42),1.)
    bright=math_node('MINIMUM',math_node('ADD',math_node('MULTIPLY',math_node('SQRT',lum),.76),.34),1.08)
    gear_bright=math_node('ADD',math_node('MULTIPLY',bright,.1),.9)
    ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.interpolation='EASE'
    ramp.color_ramp.elements[0].position=.015;ramp.color_ramp.elements[1].position=.12
    links.new(separate.outputs['Red'],ramp.inputs[0])
    suit_scale=nodes.new('ShaderNodeVectorMath');suit_scale.operation='SCALE';links.new(gear_bright,suit_scale.inputs['Scale'])
    skin_scale=nodes.new('ShaderNodeVectorMath');skin_scale.operation='SCALE';links.new(bright,skin_scale.inputs['Scale'])
    def lin(rgb):return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in [x/255 for x in rgb])
    skin_scale.inputs[0].default_value=lin((91,61,45))
    suit_mix=nodes.new('ShaderNodeMixRGB');skin_mix=nodes.new('ShaderNodeMixRGB')
    links.new(ramp.outputs[0],suit_mix.inputs[0]);links.new(tex.outputs[0],suit_mix.inputs[1]);links.new(suit_scale.outputs[0],suit_mix.inputs[2])
    links.new(separate.outputs['Blue'],skin_mix.inputs[0]);links.new(suit_mix.outputs[0],skin_mix.inputs[1]);links.new(skin_scale.outputs[0],skin_mix.inputs[2])
    mesh.data.materials[0]=material
    def render(tag,view):
        camera.location={'front':(0,-3,.55),'back':(0,3,.55),'side':(3,0,.55),'threequarter':(2,-3,.8)}[view]
        camera.rotation_euler=(Vector((0,0,.46))-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(folder/f'{stage}_{tag}_{view}.png');bpy.ops.render.render(write_still=True)
    palettes=['deep'] if stage=='before' else ['deep','red','blue','yellow','purple','original']
    for palette in palettes:
        tex.image=base_image
        suit_scale.inputs[0].default_value=lin({'deep':(24,199,216),'red':(240,20,20),'blue':(23,109,218),'yellow':(255,209,42),'purple':(139,77,255),'original':(255,255,255)}[palette])
        links.new(tex.outputs[0] if palette=='original' else skin_mix.outputs[0],emission.inputs[0])
        for view in ('front','back','side') if palette=='deep' else ('front',): render(palette,view)
    if stage!='before':
        tex.image=base_image;suit_scale.inputs[0].default_value=lin((24,199,216));links.new(skin_mix.outputs[0],emission.inputs[0])
        for action in ('breaststroke','waving'):
            data=json.loads((ROOT/f'assets/race/model-actions/tPose/Tpose_{action}.json').read_text())
            sample=data['samples'][len(data['samples'])//2]
            for bone in rig.pose.bones:
                bone.rotation_mode='QUATERNION';bone.rotation_quaternion=Quaternion((1,0,0,0))
            for bone,q in sample['rotations'].items():
                if bone in rig.pose.bones: rig.pose.bones[bone].rotation_quaternion=Quaternion((q[3],*q[:3])).normalized()
            bpy.context.view_layer.update();render(action,'threequarter')
    print('完成',name,stage,flush=True)
