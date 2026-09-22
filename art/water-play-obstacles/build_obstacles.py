"""E1 确定性作者配方；后台构建两份可编辑源、运行时模型和同源轻量回退。"""
from pathlib import Path
import sys,json,math,shutil,argparse
import bpy
SOURCE=Path(__file__).resolve().parent
ROOT=SOURCE.parents[1]
sys.path.insert(0,str(SOURCE))
from model_tools import Builder,material,geometry

BLUE=(.04,.38,.82,1);WHITE=(.9,.97,1,1);ORANGE=(1,.38,.035,1)
CYAN=(.04,.7,.78,1);DARK=(.035,.18,.32,1);LIME=(.7,.94,.14,1)

def cannon(root,mat):
    # 主体比例：底座宽 1.70m／总高 1.47m；短喷头长 0.97m，固定底座无炮轮。
    base=Builder()
    base.lathe([(0,.65),(.07,.85),(.31,.85),(.42,.7)], [BLUE,BLUE,WHITE],ellipse=.86)
    base.lathe([(.38,.4),(.52,.35),(.84,.27)],WHITE)
    # 橙色防滑踏面与底座上表面重叠 0.015m。
    base.lathe([(.405,.63),(.445,.59)],ORANGE,ellipse=.86)
    a=base.object('CannonBase',mat,root)
    head=Builder()
    head.lathe([(-.38,.11),(-.31,.34),(-.1,.43),(.15,.39),(.33,.3)],BLUE,center=(0,1.04,0),axis='z')
    # 白色喷管插入蓝色壳体 0.11m；橙色软口与管身交叠 0.04m。
    head.lathe([(.22,.265),(.38,.28),(.75,.24),(.89,.27)],WHITE,center=(0,1.04,0),axis='z')
    head.lathe([(.85,.27),(.91,.32),(.98,.32),(1.02,.26),(1.02,.17),(.87,.17)],ORANGE,center=(0,1.04,0),axis='z')
    head.lathe([(.885,.17),(.90,.17)],DARK,center=(0,1.04,0),axis='z')
    b=head.object('CannonNozzle',mat,root)
    # 喷口锚点是可见开口端面中心，运行时从同一坐标发球。
    anchor=bpy.data.objects.new('Muzzle',None);bpy.context.scene.collection.objects.link(anchor);anchor.parent=root;anchor.location=(0,-1.02,1.04)
    return [a,b], {'muzzle':[0,1.04,1.02],'contacts':{'pedestalBaseOverlap':.04,'pedestalHeadVerticalOverlap':.23,'nozzleBodyOverlap':.11,'rimPipeOverlap':.04,'mouthInsetClearance':.01}}

def buoy(root,mat):
    from buoy_recipe import build_buoy
    return build_buoy(root,mat)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--only',choices=['WaterBallCannon','SprayBuoy'])
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    reports=json.loads((SOURCE/'asset-audit.json').read_text(encoding='utf-8')) if args.only else {}
    fallback=json.loads((SOURCE/'geometry.json').read_text(encoding='utf-8')) if args.only else {}
    for name,recipe in [('WaterBallCannon',cannon),('SprayBuoy',buoy)]:
        if args.only and name!=args.only:continue
        bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
        root=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(root)
        objects,anchors=recipe(root,material())
        fallback[name]={obj.name:geometry(obj) for obj in objects}
        for obj in objects:obj.select_set(True)
        root.select_set(True)
        for child in root.children:child.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.export_scene.gltf(filepath=str(SOURCE/(name+'.glb')),export_format='GLB',use_selection=True,export_materials='EXPORT',export_vertex_color='ACTIVE',export_yup=True,export_animations=False)
        shutil.copy2(SOURCE/(name+'.glb'),ROOT/'assets/race/items'/(name+'.glb'))
        reports[name]={'meshes':len(objects),'materials':1,'textures':0,'triangles':sum(len(o.data.loop_triangles) for o in objects),'bytes':(SOURCE/(name+'.glb')).stat().st_size,**anchors}
        # 可编辑动作时间轴用于作者审查；运行时按权威阶段驱动同名部件，不加载动画系统。
        scene=bpy.context.scene;scene.render.fps=20;scene.frame_end=120 if name=='WaterBallCannon' else 70
        if name=='WaterBallCannon':
            for frame,y in [(1,-4.2),(37,0),(90,0),(114,-4.2)]:
                root.location.y=y;root.keyframe_insert('location',frame=frame)
            for frame,y in [(45,0),(47,.1),(51,0)]:
                objects[1].location.y=y;objects[1].keyframe_insert('location',frame=frame)
            root.animation_data.action.name='E_Cannon_Entry_Ready_Exit'
            objects[1].animation_data.action.name='E_Cannon_Soft_Recoil'
            scene.frame_set(40)
        else:
            for frame,z in [(1,-.82),(7,-.82),(21,.18),(27,.09),(45,.06),(55,.10),(60,.09),(66,-.76)]:
                root.location.z=z;root.keyframe_insert('location',frame=frame)
            for frame,scale in [(59,(1,1,1)),(60,(1.02,1.02,.92)),(63,(1.035,1.035,.84)),(66,(1,1,1))]:
                root.scale=scale;root.keyframe_insert('scale',frame=frame)
            root.animation_data.action.name='E_Buoy_Disturb_Rise_Float_Press_Exit';scene.frame_set(35)
            balloon=objects[1]
            for frame,scale in [(1,(.3,.3,.2)),(7,(.3,.3,.2)),(21,(1.02,1.02,1.04)),(27,(1,1,1)),(59,(1,1,1)),(60,(1.16,1.16,.90)),(62,(.001,.001,.001)),(70,(.001,.001,.001))]:
                balloon.scale=scale;balloon.keyframe_insert('scale',frame=frame)
            for frame,angle in [(21,-.08),(27,.035),(35,-.025),(45,.035),(55,-.025),(59,0)]:
                balloon.rotation_euler.y=angle;balloon.keyframe_insert('rotation_euler',frame=frame)
            balloon.animation_data.action.name='E_Buoy_Balloon_Unfold_Sway_Pop';scene.frame_set(35)
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
    (SOURCE/'geometry.json').write_text(json.dumps(fallback,separators=(',',':')),encoding='utf-8')
    (SOURCE/'asset-audit.json').write_text(json.dumps(reports,indent=2,ensure_ascii=False),encoding='utf-8')
    # 顶点色不透明、一次性固定网格。回退与 GLB 共用作者数据，不生成第二套造型。
    text='// 由 art/water-play-obstacles/build_obstacles.py 生成；不要手改。\n'
    text+='export const WATER_PLAY_GEOMETRY = '+json.dumps(fallback,separators=(',',':'))+';\n'
    (ROOT/'assets/scripts/core/WaterPlayObstacleGeometry.ts').write_text(text,encoding='utf-8')
    print(json.dumps(reports))

if __name__=='__main__':main()
