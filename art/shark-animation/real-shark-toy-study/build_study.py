"""直接修改适龄调整前的真实鲨鱼；独立试稿，不写入游戏资源。"""
import bpy, bmesh, json, math, hashlib
from pathlib import Path
from mathutils import Vector

HERE=Path(__file__).resolve().parent
SOURCE=HERE.parent/'archive/SharkModel_pre_D.blend'
BLUE=(.018,.39,.57,1); IVORY=(.79,.85,.79,1)
DARK=(.008,.035,.055,1); AMBER=(1,.43,.025,1)
TEAL=(.025,.24,.31,1); SEAM=(.085,.52,.60,1)

def color_mesh(obj,color):
    attr=obj.data.color_attributes.get('ToyColor') or obj.data.color_attributes.new(name='ToyColor',type='FLOAT_COLOR',domain='CORNER')
    for d in attr.data:d.color=color
    obj.data.materials.clear();obj.data.materials.append(material)

def bind(obj,bone):
    obj.parent=rig
    mod=obj.modifiers.new('沿用原鲨鱼骨架','ARMATURE');mod.object=rig
    group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')

def attach(name,verts,faces,color,bone):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);collection.objects.link(obj)
    color_mesh(obj,color);bind(obj,bone)
    for f in mesh.polygons:f.use_smooth=True
    return obj

def tube(name,points,radius,color,bone):
    verts=[];faces=[];n=6
    for i,p in enumerate(points):
        t=(Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])).normalized()
        u=t.cross(Vector((0,0,1))).normalized();v=t.cross(u).normalized()
        for k in range(n):verts.append(Vector(p)+radius*(math.cos(k*math.tau/n)*u+math.sin(k*math.tau/n)*v))
    for i in range(len(points)-1):
        for k in range(n):faces.append((i*n+k,i*n+(k+1)%n,(i+1)*n+(k+1)%n,(i+1)*n+k))
    faces.extend([tuple(reversed(range(n))),tuple((len(points)-1)*n+i for i in range(n))])
    return attach(name,verts,faces,color,bone)

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene=bpy.context.scene;scene.render.fps=24;scene.frame_set(1)
rig=bpy.data.objects['Shark_Rig'];body=bpy.data.objects['Shark_Mesh']
rig.data.pose_position='REST'
for obj in list(bpy.data.objects):
    if obj not in (rig,body):bpy.data.objects.remove(obj,do_unlink=True)
collection=bpy.data.collections.new('真实鲨鱼改造试稿');scene.collection.children.link(collection)
for obj in (rig,body):
    for col in list(obj.users_collection):col.objects.unlink(obj)
    collection.objects.link(obj)
original=[v.co.copy() for v in body.data.vertices]
rest={b.name:[list(row) for row in b.matrix_local] for b in rig.data.bones}
original_material=body.data.materials[0]
im=next(n.image for n in original_material.node_tree.nodes if n.type=='TEX_IMAGE')
pixels=list(im.pixels);width,height=im.size;uv=body.data.uv_layers.active.data
# 原网格的独立表面块：直接给背部与腹部铺连续色，不把旧贴图阴影当作新花纹。
neighbors=[set() for _ in body.data.vertices]
for edge in body.data.edges:
    a,b=edge.vertices;neighbors[a].add(b);neighbors[b].add(a)
remaining=set(range(len(body.data.vertices)));component={};part_index=0
while remaining:
    start=remaining.pop();stack=[start];component[start]=part_index
    while stack:
        for q in neighbors[stack.pop()]:
            if q in remaining:remaining.remove(q);stack.append(q);component[q]=part_index
    part_index+=1
assert part_index==126,'原网格结构变化，需要重新确认分区'
blue_parts={0,1,2,3,13,14,37,38,39,100,111,115,122,125}
belly_parts={4,5,6,7,8,23,24,31,32,64,118,119,120,121,123,124}
palette=[]
for loop in body.data.loops:
    u,v=uv[loop.index].uv
    k=(min(height-1,max(0,int(v*height)))*width+min(width-1,max(0,int(u*width))))*4
    r,g,b=pixels[k:k+3];c=body.data.vertices[loop.vertex_index].co
    if max(r,g,b)<.17:color=TEAL if c.y>-.255 else DARK
    elif b>r+.004:color=BLUE
    elif r>g*1.28 and g>b*1.5 and r>.20:color=AMBER
    elif (r+g+b)/3>.13:color=IVORY
    else:color=TEAL if c.y>-.255 else DARK
    part=component[loop.vertex_index]
    if part in blue_parts:
        color=IVORY if part in {13,14,39,100,111,115} and c.z<.147 else BLUE
        if c.y>-.20 and abs(c.x)<.15 and c.z<.125:color=IVORY
    elif part in belly_parts:
        color=BLUE if part in {4,5,120} and c.z>.142 else IVORY
    palette.append(color)

material=bpy.data.materials.new('充气软塑料_单顶点色材质');material.use_nodes=True
bsdf=material.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value=.42
bsdf.inputs['Metallic'].default_value=0
bsdf.inputs['Coat Weight'].default_value=.08
bsdf.inputs['Coat Roughness'].default_value=.24
vc=material.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='ToyColor'
material.node_tree.links.new(vc.outputs['Color'],bsdf.inputs['Base Color'])
body.data.materials.clear();body.data.materials.append(material)
attr=body.data.color_attributes.new(name='ToyColor',type='FLOAT_COLOR',domain='CORNER')
for i,color in enumerate(palette):attr.data[i].color=color

# 保留原躯干与鳍尾，只有鳍尖微量钝化和眉峰抬起。
for v in body.data.vertices:
    x,y,z=v.co
    if z>.475:v.co.z-=min(.008,(z-.475)*.23)
    if abs(x)>.270:v.co.x-=math.copysign(min(.005,(abs(x)-.270)*.18),x)
    if -.365<y<-.275 and .055<abs(x)<.125 and .195<z<.248:
        v.co.z+=.007*math.exp(-((y+.324)/.035)**2)*max(0,1-abs(z-.214)/.035)

# 临时焊接副本只用于找牙齿；作者本体保留原拓扑与分裂法线。
bm=bmesh.new();bm.from_mesh(body.data);deform=bm.verts.layers.deform.active
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00002)
key=lambda p:tuple(round(c,5) for c in p)
old_positions={v:key(v.co) for v in bm.verts}
jaw_index=body.vertex_groups['Shark_Jaw'].index
seen=set();teeth=[]
for vert in bm.verts:
    if vert in seen:continue
    stack=[vert];seen.add(vert);part=[]
    while stack:
        p=stack.pop();part.append(p)
        for e in p.link_edges:
            q=e.other_vert(p)
            if q not in seen:seen.add(q);stack.append(q)
    lo=Vector([min(v.co[k] for v in part) for k in range(3)])
    hi=Vector([max(v.co[k] for v in part) for k in range(3)])
    if len(part)<110 and hi.z<.15 and hi.y<-.24:
        lower=sum(v[deform].get(jaw_index,0) for v in part)>len(part)*.5
        anchor=lo.z if lower else hi.z
        for v in part:v.co.z=anchor+(v.co.z-anchor)*.73
        teeth.append((part,lower))
for part,lower in teeth:
    for _ in range(3):bmesh.ops.smooth_vert(bm,verts=part,factor=.42,use_axis_x=True,use_axis_y=True,use_axis_z=True)
moved={old_positions[v]:v.co.copy() for part,_ in teeth for v in part}
for vert in body.data.vertices:
    if key(vert.co) in moved:vert.co=moved[key(vert.co)]
bm.free();body.data.update()

anchors=[]
def surface(y,z,side):
    hit,point,normal,_=body.ray_cast(Vector((side*2,y,z)),Vector((-side,0,0)))
    if not hit:raise RuntimeError('找不到原鲨鱼侧面锚点')
    return point,normal

# 原眼窝和虹膜保留；给两个小眼补清晰瞳孔与高光，避免旧贴图细节丢失后发空。
for side in (-1,1):
    ec,en=surface(-.317,.184,side);en.normalize()
    eu=Vector((0,1,0));eu=(eu-en*eu.dot(en)).normalized();ev=en.cross(eu).normalized()
    if ev.z<0:ev=-ev
    def eye_patch(name,c,ry,rz,color,offset):
        count=16;vv=[c+en*(offset+.0015)]
        vv.extend(c+eu*(ry*math.cos(i*math.tau/count))+ev*(rz*math.sin(i*math.tau/count))+en*offset for i in range(count))
        ff=[(0,1+i,1+(i+1)%count) for i in range(count)]
        return attach(name,vv,ff,color,'Shark_Head')
    ec+=ev*.003
    eye_patch(('左' if side<0 else '右')+'眼_印刷虹膜',ec,.014,.016,AMBER,.0008)
    eye_patch(('左' if side<0 else '右')+'眼_清晰瞳孔',ec,.0075,.009,DARK,.0025)
    eye_patch(('左' if side<0 else '右')+'眼_高光',ec-eu*.002+ev*.003,.0025,.0025,(.96,1,1,1),.0043)

# 气阀背盘沿真实后侧壳面取样，避免悬空；瓣片与背盘明确相交。
center,normal=surface(.16,.192,-1)
normal.normalize();u=Vector((0,1,0));u=(u-normal*u.dot(normal)).normalized();v=normal.cross(u).normalized()
verts=[];n=20;gaps=[]
for radius,depth in [(.029,-.0010),(.029,.0014),(.020,.0035)]:
    for i in range(n):
        p=center+radius*(math.cos(i*math.tau/n)*u+math.sin(i*math.tau/n)*v)
        hit,point,nn,_=body.ray_cast(p+normal*.15,-normal)
        if not hit:raise RuntimeError('气阀底盘未完整落在原侧壳')
        verts.append(point+nn*depth);gaps.append(depth)
faces=[]
for j in range(2):
    for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
faces.extend([tuple(reversed(range(n))),tuple(2*n+i for i in range(n))])
attach('后侧充气阀_贴合背盘',verts,faces,TEAL,'Shark_Tail_Base')

def disc(name,radius,depth0,depth1,color):
    vv=[]
    for r,d in [(radius*.88,depth0),(radius,depth0+.0015),(radius,depth1-.0015),(radius*.86,depth1)]:
        vv.extend(center+u*(r*math.cos(i*math.tau/n))+v*(r*math.sin(i*math.tau/n))+normal*d for i in range(n))
    ff=[]
    for j in range(3):
        for i in range(n):ff.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    ff.extend([tuple(reversed(range(n))),tuple(3*n+i for i in range(n))])
    return attach(name,vv,ff,color,'Shark_Tail_Base')
disc('后侧充气阀_软塞',.018,.002,.010,AMBER)
tube('后侧充气阀_连体拉片',[center+u*.012+normal*.007,center+u*.025+normal*.008,center+u*.032+normal*.004],.0045,AMBER,'Shark_Tail_Base')
anchors.append({'part':'充气阀背盘','parent':'原鲨鱼后侧壳','center':list(center),'normal':list(normal),'base_overlap':.001,'ring_samples':len(gaps),'cap_base':.002,'backplate_top':.0035})

# 热压接缝分段绑定于原躯干骨，沿两侧壳面定位，不沿空中直线搭桥。
for side in (-1,1):
    points=[]
    for i in range(25):
        y=-.21+i*.017;z=.129+math.sin((y+.21)/.408*math.pi)*.013
        p,nn=surface(y,z,side);points.append(p+nn*.0004)
    for j,(a,b,bone) in enumerate([(0,11,'Shark_Body_A'),(10,20,'Shark_Body_B'),(19,25,'Shark_Tail_Base')]):
        tube(('左' if side<0 else '右')+'侧热压接缝_'+str(j),points[a:b],.0015,SEAM,bone)

for obj in collection.objects:
    if obj.type=='MESH':obj.data.update()
scene.frame_set(1);rig.data.pose_position='REST'
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
scene.world=bpy.data.worlds.new('试稿环境');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.11,.16,.21,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.6
scene.view_settings.view_transform='AgX'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'Shark_Original_Toy_Study.blend'))

# 导出副本临时合并，作者源保留可单独编辑的阀门和接缝。
meshes=[o for o in collection.objects if o.type=='MESH']
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:obj.select_set(True)
bpy.context.view_layer.objects.active=body;bpy.ops.object.join()
body.name='Shark_Original_Toy_Study';rig.select_set(True)
body.data.calc_loop_triangles()
bpy.ops.export_scene.gltf(filepath=str(HERE/'Shark_Original_Toy_Study.glb'),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_texcoords=False,export_normals=True,export_materials='EXPORT')
audit={'source':'../archive/SharkModel_pre_D.blend','source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'scope':'独立造型试稿，未接入游戏，未修改动作时序','original_vertices':len(original),'triangles':len(body.data.loop_triangles),'vertices':len(body.data.vertices),'bones':len(rig.data.bones),'rest_matrices_unchanged':all(rest[b.name]==[list(row) for row in b.matrix_local] for b in rig.data.bones),'textures':0,'materials':len(body.data.materials),'rounded_teeth_components':len(teeth),'attachments':anchors,'glb_bytes':(HERE/'Shark_Original_Toy_Study.glb').stat().st_size}
(HERE/'study-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
print('试稿制作完成',json.dumps(audit,ensure_ascii=False))
