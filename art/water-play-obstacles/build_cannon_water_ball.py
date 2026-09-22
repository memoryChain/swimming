"""飞行水球作者配方：单网格、单材质、烘入顶点色的水色层次与湿润高光。"""
from pathlib import Path
import sys,math,json,shutil
import bpy
SOURCE=Path(__file__).resolve().parent;ROOT=SOURCE.parents[1];sys.path.insert(0,str(SOURCE))
from model_tools import Builder,material,geometry
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
root=bpy.data.objects.new('CannonWaterBall',None);bpy.context.scene.collection.objects.link(root)
builder=Builder();segments=24;latitude=16
builder.vertices.append((0,.27,0))
for j in range(1,latitude):
    a=math.pi*j/latitude;ny=math.cos(a);r=.25*math.sin(a)*(1+.10*ny)
    for i in range(segments):
        angle=math.tau*i/segments;builder.vertices.append((r*math.cos(angle),ny*.27,r*math.sin(angle)))
bottom=len(builder.vertices);builder.vertices.append((0,-.27,0))
def face(indices):builder.faces.append(indices);builder.colors.append((1,1,1,1))
for i in range(segments):face((0,1+i,1+(i+1)%segments))
for j in range(latitude-2):
    for i in range(segments):
        a=1+j*segments+i;b=1+j*segments+(i+1)%segments
        face((a,a+segments,b+segments,b))
for i in range(segments):face((bottom,1+(latitude-2)*segments+(i+1)%segments,1+(latitude-2)*segments+i))
mat=material();obj=builder.object('WaterBallSurface',mat,root)
attr=obj.data.color_attributes.active_color
def normalized(v):
    length=math.sqrt(sum(x*x for x in v));return tuple(x/length for x in v)
key=normalized((-.55,.60,.58));back=normalized((.60,.57,-.56))
for polygon in obj.data.polygons:
    for loop in polygon.loop_indices:
        p=obj.data.vertices[obj.data.loops[loop].vertex_index].co
        x,y,z=normalized((p.x/.25,p.z/.27,-p.y/.25))
        depth=max(0,min(1,.23+.64*(y*.5+.5)+.12*(z*.5+.5)))
        dark=(.018,.22,.57);light=(.11,.84,.96)
        color=[dark[k]+(light[k]-dark[k])*depth for k in range(3)]
        gloss=max(max(0,x*key[0]+y*key[1]+z*key[2])**48,
                  .84*max(0,x*back[0]+y*back[1]+z*back[2])**56)
        rim=math.exp(-((y+.46)/.15)**2)*max(0,.65*z-.3*x)*.25
        glow=min(1,gloss*.99+rim)
        color=[v+(1-v)*glow for v in color]
        attr.data[loop].color_srgb=(*color,1)
# 作者预览也使用同一顶点色发光着色，不依赖离线棚灯伪造运行时高光。
nodes=mat.node_tree.nodes;output=nodes.get('Material Output');vertex=next(n for n in nodes if n.type=='VERTEX_COLOR')
emission=nodes.new('ShaderNodeEmission');mat.node_tree.links.new(vertex.outputs['Color'],emission.inputs['Color']);mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
obj.select_set(True);root.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(SOURCE/'CannonWaterBall.glb'),export_format='GLB',use_selection=True,export_materials='EXPORT',export_vertex_color='ACTIVE',export_yup=True,export_animations=False)
shutil.copy2(SOURCE/'CannonWaterBall.glb',ROOT/'assets/race/items/CannonWaterBall.glb')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'CannonWaterBall.blend'))
fallback=json.loads((SOURCE/'geometry.json').read_text(encoding='utf-8'));fallback['CannonWaterBall']={'WaterBallSurface':geometry(obj)}
(SOURCE/'geometry.json').write_text(json.dumps(fallback,separators=(',',':')),encoding='utf-8')
(ROOT/'assets/scripts/core/WaterPlayObstacleGeometry.ts').write_text('// 由 art/water-play-obstacles 的作者配方生成；不要手改。\nexport const WATER_PLAY_GEOMETRY = '+json.dumps(fallback,separators=(',',':'))+';\n',encoding='utf-8')
audit=json.loads((SOURCE/'asset-audit.json').read_text(encoding='utf-8'));audit['CannonWaterBall']={'meshes':1,'materials':1,'textures':0,'triangles':len(obj.data.loop_triangles),'bytes':(SOURCE/'CannonWaterBall.glb').stat().st_size,'boundsY':[-.27,.27],'visualOnly':True}
(SOURCE/'asset-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(audit['CannonWaterBall']))
