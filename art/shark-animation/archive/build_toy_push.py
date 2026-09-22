"""D 充气玩具鲨：沿用原作者源身份、7 骨骼和游动动作的确定性制作入口。"""
import bpy, bmesh, math, json, sys, struct
from pathlib import Path
from mathutils import Vector, Quaternion
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
SOURCE=HERE/'SharkModel_bite_source.blend'
ARCHIVE=HERE/'archive/SharkModel_pre_D.blend'
BLUE=(.015,.49,.68,1); BELLY=(.73,.94,.91,1); DARK=(.008,.038,.075,1)
TEAL=(.025,.68,.70,1); ORANGE=(1,.32,.035,1); WHITE=(.98,1,.96,1)
VERTS=[]; FACES=[]; COLORS=[]; PARTS=[]
# 鼻头 -Y，+Z 向上。各接环为纵向、半宽、半高、中心高。
RINGS=[(-.475,.018,.020,.24),(-.44,.08,.055,.24),(-.36,.155,.11,.24),
       (-.23,.196,.151,.25),(-.04,.205,.164,.25),(.17,.172,.134,.25),
       (.35,.122,.095,.25),(.50,.068,.055,.25),(.64,.038,.040,.25),(.70,.032,.032,.25)]

def part(name,v,f,color):
    start=len(VERTS); VERTS.extend(v)
    FACES.extend(tuple(start+i for i in face) for face in f); COLORS.extend([color]*len(f))
    PARTS.append({'name':name,'first':start,'count':len(v)})

def loft(name,rings,color,sides=12):
    # 每个截面使用中心和两条轴，连续桥接并封端。
    v=[]; f=[]
    for center,u,w in rings:
        for i in range(sides):
            a=2*math.pi*i/sides
            v.append(tuple(Vector(center)+math.cos(a)*Vector(u)+math.sin(a)*Vector(w)))
    for j in range(len(rings)-1):
        for i in range(sides): f.append((j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i))
    f.extend([tuple(reversed(range(sides))),tuple((len(rings)-1)*sides+i for i in range(sides))])
    part(name,v,f,color)

def ellipsoid(name,c,r,color,n=12,m=6):
    rings=[]
    for j in range(m+1):
        a=math.pi*j/m
        rings.append(((c[0],c[1],c[2]+r[2]*math.cos(a)),(r[0]*math.sin(a),0,0),(0,r[1]*math.sin(a),0)))
    loft(name,rings,color,n)

def tube(name,points,radius,color,sides=6):
    rings=[]
    for i,p in enumerate(points):
        t=(Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)])).normalized()
        u=t.cross(Vector((0,0,1)))
        if u.length<.01: u=t.cross(Vector((0,1,0)))
        u.normalize(); w=t.cross(u).normalized()
        rings.append((p,u*radius,w*radius))
    loft(name,rings,color,sides)

def build_body():
    start=len(FACES)
    loft('鼓鼓主体与圆鼻头',[((0,y,z),(rx,0,0),(0,0,rz)) for y,rx,rz,z in RINGS],BLUE,24)
    for i in range(start,len(FACES)-2):
        # 固定角度边界，避免按面中心高度挑色造成牙齿状阶梯。
        if 13 <= (i-start)%24 <= 22: COLORS[i]=BELLY

def build_fins():
    path=[(0,.08,.35,.053,.135),(0,.13,.43,.04,.11),(0,.19,.535,.024,.066),(0,.225,.58,.018,.035),(0,.245,.585,.004,.01)]
    loft('短圆背鳍',[((x,y,z),(rx,0,0),(0,ry,0)) for x,y,z,rx,ry in path],BLUE,10)
    for s in (-1,1):
        path=[(s*.165,.015,.215,.073,.026),(s*.255,.09,.185,.078,.028),(s*.345,.205,.16,.050,.022),(s*.37,.25,.17,.005,.007)]
        loft('左软鳍' if s<0 else '右软鳍',[((x,y,z),(0,ry,0),(0,0,rz)) for x,y,z,ry,rz in path],TEAL,10)
        height=.24 if s>0 else .185
        path=[(0,.65,.25,.033,.045),(0,.735,.25+s*height*.35,.029,.06),(0,.795,.25+s*height*.82,.02,.062),
              (0,.85,.25+s*height,.012,.040),(0,.882,.25+s*height*.99,.003,.007)]
        loft('尾鳍上瓣' if s>0 else '尾鳍下瓣',[((x,y,z),(rx,0,0),(0,ry,0)) for x,y,z,rx,ry in path],TEAL,10)

def front_y(x,z):
    # 在分段椭圆外壳上解前表面位置，表情接触点从同一网格截环推导。
    for (ya,xa,za,ca),(yb,xb,zb,cb) in zip(RINGS,RINGS[1:]):
        va=(x/xa)**2+((z-ca)/za)**2
        vb=(x/xb)**2+((z-cb)/zb)**2
        if va>=1 and vb<=1:
            lo=0.; hi=1.
            for _ in range(24):
                t=(lo+hi)/2; rx=xa+(xb-xa)*t; rz=za+(zb-za)*t; cz=ca+(cb-ca)*t
                if (x/rx)**2+((z-cz)/rz)**2>1: lo=t
                else: hi=t
            return ya+(yb-ya)*hi
    raise ValueError(('表情锚点不在外壳上',x,z))

def build_face():
    for s in (-1,1):
        x=s*.155; z=.29; y=front_y(x,z)
        ellipsoid('眼白',(x,y-.008,z),(.030,.019,.030),WHITE,16,8)
        ellipsoid('瞳孔',(x+s*.006,y-.026,z-.002),(.014,.008,.021),DARK)
        ellipsoid('眼睛高光',(x+s*.003,y-.032,z+.007),(.004,.003,.006),WHITE,8,4)
        points=[]
        for i in range(7):
            xx=x-.025+.05*i/6; zz=z+.031+s*(xx-x)*.18
            points.append((xx,front_y(xx,zz)-.018,zz))
        tube('得意眉眼',points,.008,BLUE,8)
    smile=[]
    for i in range(17):
        x=-.15+.30*i/16; z=.185+.018*(abs(x)/.15)**1.6+.004*x/.15
        smile.append((x,front_y(x,z)-.006,z))
    tube('闭合弧形笑脸',smile,.0065,DARK)
    for s in (-1,1):
        x=s*.15; z=.208
        tube('笑脸端点',[(x,front_y(x,z)-.005,z-.012),(x,front_y(x,z)-.005,z+.009)],.005,DARK)

def build_details():
    for s in (-1,1):
        points=[]
        for y,rx,rz,z in RINGS[2:-1]:
            zz=z-rz*math.sin(math.pi/12)
            xx=s*rx*math.cos(math.pi/12)
            points.append((xx*1.003,y,zz))
        tube('热合接缝',points,.0035,TEAL)
    for s in (-1,1):
        for y in (-.04,.015,.07):
            t=(y+.04)/.21; rx=.205+(.172-.205)*t; rz=.164+(.134-.164)*t
            points=[(s*rx*math.sqrt(1-((z-.25)/rz)**2)*1.007,y,z) for z in (.205,.25,.295)]
            tube('软壳鳃纹',points,.0038,DARK,6)
    ellipsoid('气阀底座',(0,.405,.324),(.029,.034,.01),BELLY,12,4)
    ellipsoid('橙色软气阀',(0,.405,.335),(.020,.023,.011),ORANGE,12,4)

def create_mesh(rig):
    mesh=bpy.data.meshes.new('Shark_Mesh'); mesh.from_pydata(VERTS,[],FACES); mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for p in mesh.polygons:
        for li in p.loop_indices: attr.data[li].color=COLORS[p.index]
        p.use_smooth=True
    bm=bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new('Shark_Mesh',mesh); bpy.context.scene.collection.objects.link(obj); obj.parent=rig
    material=bpy.data.materials.new('Shark_Mat'); material.use_nodes=True
    nt=material.node_tree; bsdf=nt.nodes.get('Principled BSDF'); bsdf.inputs['Roughness'].default_value=.36
    vc=nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name='Color'; nt.links.new(vc.outputs['Color'],bsdf.inputs['Base Color'])
    mesh.materials.append(material)
    groups={b.name:obj.vertex_groups.new(name=b.name) for b in rig.data.bones}
    anchors=[('Shark_Head',-.30),('Shark_Body_A',-.07),('Shark_Body_B',.20),('Shark_Tail_Base',.48),('Shark_Tail_Mid',.68),('Shark_Tail_Tip',.81)]
    for v in mesh.vertices:
        y=v.co.y
        if y<=anchors[0][1]: groups[anchors[0][0]].add([v.index],1,'REPLACE'); continue
        if y>=anchors[-1][1]: groups[anchors[-1][0]].add([v.index],1,'REPLACE'); continue
        for (a,ay),(b,by) in zip(anchors,anchors[1:]):
            if ay<=y<=by:
                t=(y-ay)/(by-ay); groups[a].add([v.index],1-t,'REPLACE'); groups[b].add([v.index],t,'REPLACE'); break
    mod=obj.modifiers.new('原鲨鱼骨架蒙皮','ARMATURE'); mod.object=rig
    return obj

def assign_action(rig,action):
    rig.animation_data.action=action
    if action.slots: rig.animation_data.action_slot=action.slots[0]

def build_actions(rig,swim):
    scene=bpy.context.scene
    for track in list(rig.animation_data.nla_tracks): rig.animation_data.nla_tracks.remove(track)
    assign_action(rig,swim); sampled=[]
    for i in range(11):
        f=1+i*2.4; scene.frame_set(int(f),subframe=f%1)
        sampled.append({b.name:b.matrix_basis.decompose() for b in rig.pose.bones})
    for a in list(bpy.data.actions):
        if a!=swim: bpy.data.actions.remove(a)
    action=bpy.data.actions.new('Shark_Bite'); action.use_fake_user=True; assign_action(rig,action)
    keys=[(1,0,1,0),(2,.018,.966,-2),(3.16,-.006,1.012,1),(4,-.003,1.018,1.2),
          (6,.012,.985,-1),(8,-.003,1.005,.4),(11,0,1,0)]
    for frame,dy,sy,pitch in keys:
        for bone in rig.pose.bones:
            loc,rot,scale=sampled[min(10,round(frame-1))][bone.name]
            bone.location=loc; bone.rotation_mode='QUATERNION'; bone.rotation_quaternion=rot; bone.scale=scale
            if bone.name=='Shark_Jaw': bone.matrix_basis.identity()
            if bone.name=='Shark_Head':
                bone.location.y+=dy; bone.scale=(1+(1-sy)*.6,sy,1+(1-sy)*.4)
                bone.rotation_quaternion=rot @ Quaternion((1,0,0),math.radians(pitch))
            for channel in ('location','rotation_quaternion','scale'): bone.keyframe_insert(data_path=channel,frame=frame,group=bone.name)
    action['contact_seconds']=.09
    entry=bpy.data.actions.new('Shark_Entry_Rise'); entry.use_fake_user=True; assign_action(rig,entry)
    # 这里只摆正身体；真实上浮位移由既有入场控制器消费权威时间。
    for frame,pitch in [(1,-7),(10,-4),(20,2),(27.4,0)]:
        for bone in rig.pose.bones:
            loc,rot,scale=sampled[0][bone.name]
            bone.location=loc; bone.rotation_mode='QUATERNION'; bone.rotation_quaternion=rot; bone.scale=scale
            if bone.name=='Shark_Jaw': bone.matrix_basis.identity()
            if bone.name=='Shark_Head': bone.rotation_quaternion=rot @ Quaternion((1,0,0),math.radians(pitch))
            for channel in ('location','rotation_quaternion','scale'): bone.keyframe_insert(data_path=channel,frame=frame,group=bone.name)
    assign_action(rig,swim); scene.frame_set(1)

def export(apply):
    bpy.ops.object.select_all(action='DESELECT')
    for name in ('Shark_Rig','Shark_Mesh'): bpy.data.objects[name].select_set(True)
    output=ROOT/'assets/race/models/SharkModel.glb' if apply else HERE/'SharkModel_preview.glb'
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,
        export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,
        export_force_sampling=False,export_anim_slide_to_zero=True,
        export_optimize_animation_size=True,export_anim_single_armature=True)
    # 非烘焙导出仍可能保留 Blender 第 1 帧的 1/24s 起始偏移。
    # 在原导出流程内明确归零输入时间，避免 Cocos 在接触前多等一帧。
    raw=output.read_bytes(); size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size]); binary=bytearray(raw[28+size:]); shifts={}
    for anim in doc.get('animations',[]):
        offset=min(doc['accessors'][s['input']]['min'][0] for s in anim['samplers'])
        for sampler in anim['samplers']:
            index=sampler['input']
            if index in shifts:
                assert abs(shifts[index]-offset)<1e-7
                continue
            shifts[index]=offset; acc=doc['accessors'][index]; view=doc['bufferViews'][acc['bufferView']]
            assert acc['componentType']==5126 and acc['type']=='SCALAR'
            start=view.get('byteOffset',0)+acc.get('byteOffset',0); stride=view.get('byteStride',4)
            for i in range(acc['count']):
                value=struct.unpack_from('<f',binary,start+i*stride)[0]
                struct.pack_into('<f',binary,start+i*stride,max(0,value-offset))
            acc['min']=[0.0]; acc['max']=[acc['max'][0]-offset]
    chunk=json.dumps(doc,separators=(',',':')).encode(); chunk+=b' '*((-len(chunk))%4)
    output.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(chunk)+len(binary))+struct.pack('<I4s',len(chunk),b'JSON')+chunk+struct.pack('<I4s',len(binary),b'BIN\0')+binary)
    print('D_EXPORT='+str(output))

def main():
    bpy.ops.wm.open_mainfile(filepath=str(ARCHIVE))
    rig=bpy.data.objects['Shark_Rig']; rig.animation_data_create()
    rest={b.name:[list(row) for row in b.matrix_local] for b in rig.data.bones}
    for obj in list(bpy.data.objects):
        if obj!=rig: bpy.data.objects.remove(obj,do_unlink=True)
    for mat in list(bpy.data.materials): bpy.data.materials.remove(mat)
    swim=bpy.data.actions['Shark_Swim_Loop']
    build_body(); build_fins(); build_face(); build_details(); mesh=create_mesh(rig); build_actions(rig,swim)
    assert rest=={b.name:[list(row) for row in b.matrix_local] for b in rig.data.bones}
    assert all(abs(sum(g.weight for g in v.groups)-1)<.00001 for v in mesh.data.vertices)
    assert not any(g.group==mesh.vertex_groups['Shark_Jaw'].index and g.weight>0 for v in mesh.data.vertices for g in v.groups)
    scene=bpy.context.scene; scene.render.fps=24; scene.frame_start=1; scene.frame_end=25
    scene['D_作者源']='唯一正式源；archive 仅追溯，手改后用 --export-only 导出'
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE)); export('--apply' in sys.argv)
    mesh.data.calc_loop_triangles()
    (HERE/'source-audit.json').write_text(json.dumps({'bones':len(rig.data.bones),'rest_matrices_unchanged':True,
      'vertices':len(mesh.data.vertices),'triangles':len(mesh.data.loop_triangles),'meshes':1,'materials':1,'textures':0,
      'blender_bounds':[[min(v.co[i] for v in mesh.data.vertices) for i in range(3)],[max(v.co[i] for v in mesh.data.vertices) for i in range(3)]],
      'contact_seconds':.09,'clip_seconds':10/24,'jaw_weighted_vertices':0,'parts':PARTS},ensure_ascii=False,indent=2),encoding='utf8')

if __name__=='__main__':
    if '--export-only' in sys.argv:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE)); export('--apply' in sys.argv)
    else: main()
