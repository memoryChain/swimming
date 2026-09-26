"""已认可的原鲨鱼玩具化模型：正式源、三段动作与原路径导出。"""
import bpy, bmesh, math, json, sys, struct, hashlib
from pathlib import Path
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.geometry import closest_point_on_tri
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
SOURCE=HERE/'SharkModel_bite_source.blend'
APPROVED=HERE/'real-shark-toy-study/Shark_Original_Toy_Study.blend'

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
    # 玩具鲨失控冲撞：先歪向目标，鼻头接触时压缩，随后冲过头再弹回。
    # 下颌保持静止；Shark_Bite 仅保留既有资源和运行时兼容名。
    keys=[(1,0,0),(1.96,.012,-6),(3.16,-.020,9),
          (4.12,-.012,12),(6,.018,-7),(8,-.006,2),(11,0,0)]
    for frame,dy,roll in keys:
        for bone in rig.pose.bones:
            loc,rot,scale=sampled[min(10,round(frame-1))][bone.name]
            bone.location=loc; bone.rotation_mode='QUATERNION'; bone.rotation_quaternion=rot; bone.scale=scale
            if bone.name=='Shark_Jaw':
                bone.matrix_basis.identity()
            if bone.name=='Shark_Head':
                bone.location.y+=dy
                bone.rotation_quaternion=rot @ Quaternion((0,1,0),math.radians(roll))
            if bone.name in ('Shark_Body_A','Shark_Body_B'):
                bone.rotation_quaternion=rot @ Quaternion((0,1,0),math.radians(roll * (.45 if bone.name=='Shark_Body_A' else .7)))
            for channel in ('location','rotation_quaternion','scale'): bone.keyframe_insert(data_path=channel,frame=frame,group=bone.name)
    action['contact_seconds']=.09
    action['impact_seconds']=.09; action['overshoot_seconds']=.13
    # 限定插值，避免短促开闭在相邻关键帧之间过冲。
    for slot in action.slots:
        for layer in action.layers:
            for strip in layer.strips:
                bag=strip.channelbag(slot)
                if bag:
                    for fc in bag.fcurves:
                        for key in fc.keyframe_points:key.interpolation='LINEAR'
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

def transfer_detail_weights(body, details):
    # 按父壳最近三角面插值蒙皮，避免气阀和接缝在尾摆时与身体分离。
    mesh=body.data; mesh.calc_loop_triangles()
    triangles=[tuple(t.vertices) for t in mesh.loop_triangles]
    tree=BVHTree.FromPolygons([v.co for v in mesh.vertices],triangles,all_triangles=True)
    weights=[{body.vertex_groups[g.group].name:g.weight for g in v.groups} for v in mesh.vertices]
    def barycentric(p,a,b,c):
        u=b-a;v=c-a;w=p-a;den=u.dot(u)*v.dot(v)-u.dot(v)**2
        if abs(den)<1e-14:return (1,0,0)
        y=(v.dot(v)*w.dot(u)-u.dot(v)*w.dot(v))/den
        z=(u.dot(u)*w.dot(v)-u.dot(v)*w.dot(u))/den
        return (1-y-z,y,z)
    for obj in details:
        obj.vertex_groups.clear()
        groups={b.name:obj.vertex_groups.new(name=b.name) for b in rig.data.bones}
        for vertex in obj.data.vertices:
            point,normal,index,distance=tree.find_nearest(vertex.co)
            ids=triangles[index];a,b,c=(mesh.vertices[i].co for i in ids)
            factors=barycentric(point,a,b,c);mixed={}
            for i,f in zip(ids,factors):
                for name,value in weights[i].items():mixed[name]=mixed.get(name,0)+max(0,f)*value
            total=sum(mixed.values());assert total>0
            for name,value in mixed.items():
                if value>1e-7:groups[name].add([vertex.index],value/total,'REPLACE')

def repair_jaw_weights(body):
    # 原源有 UV 拆点权重不一致及上排牙归到下颌的问题；不改已认可的静止几何。
    jaw=body.vertex_groups['Shark_Jaw'];head=body.vertex_groups['Shark_Head']
    key=lambda p:tuple(round(c,5) for c in p)
    shared={}
    for vertex in body.data.vertices:
        value=next((g.weight for g in vertex.groups if g.group==jaw.index),0)
        shared[key(vertex.co)]=max(shared.get(key(vertex.co),0),value)
    for vertex in body.data.vertices:
        value=shared[key(vertex.co)]
        if value<=0:continue
        t=max(0,min(1,(-.205-vertex.co.y)/.080));value*=t*t*(3-2*t)
        for group in body.vertex_groups:group.remove([vertex.index])
        jaw.add([vertex.index],value,'REPLACE');head.add([vertex.index],1-value,'REPLACE')
    bm=bmesh.new();bm.from_mesh(body.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00002)
    seen=set();teeth={}
    for vertex in bm.verts:
        if vertex in seen:continue
        stack=[vertex];seen.add(vertex);part=[]
        while stack:
            p=stack.pop();part.append(p)
            for edge in p.link_edges:
                q=edge.other_vert(p)
                if q not in seen:seen.add(q);stack.append(q)
        if len(part)<110 and max(v.co.z for v in part)<.15 and max(v.co.y for v in part)<-.24:
            lower=min(v.co.z for v in part)<.075
            for p in part:teeth[key(p.co)]=lower
    for vertex in body.data.vertices:
        k=key(vertex.co)
        if k not in teeth:continue
        for group in body.vertex_groups:group.remove([vertex.index])
        (jaw if teeth[k] else head).add([vertex.index],1,'REPLACE')
    bm.free()

def remove_sharp_teeth(body):
    # 仅删原网格八个独立尖牙岛；嘴唇、下颌和已认可的头身轮廓保留。
    key=lambda p:tuple(round(c,5) for c in p)
    welded=bmesh.new();welded.from_mesh(body.data)
    bmesh.ops.remove_doubles(welded,verts=list(welded.verts),dist=.00002)
    seen=set();tooth_keys=set();islands=0
    for start in welded.verts:
        if start in seen:continue
        stack=[start];seen.add(start);part=[]
        while stack:
            v=stack.pop();part.append(v)
            for edge in v.link_edges:
                next_vertex=edge.other_vert(v)
                if next_vertex not in seen:seen.add(next_vertex);stack.append(next_vertex)
        if len(part)<110 and max(v.co.z for v in part)<.15 and max(v.co.y for v in part)<-.24:
            islands+=1;tooth_keys.update(key(v.co) for v in part)
    welded.free();assert islands==8, f'预期八个独立尖牙岛，实际 {islands}'
    bm=bmesh.new();bm.from_mesh(body.data)
    removed=[v for v in bm.verts if key(v.co) in tooth_keys]
    assert len(removed)>150
    bmesh.ops.delete(bm,geom=removed,context='VERTS')
    bm.to_mesh(body.data);bm.free();body.data.update()
    return {'teeth_islands_removed':islands,'source_vertices_removed':len(removed)}

def add_toy_hardware(body,rig):
    # 数值锚点来自原壳体 BVH 射线交点；底座与壳面重叠，不悬浮。
    bm=bmesh.new();bm.from_mesh(body.data);tree=BVHTree.FromBMesh(bm)
    antenna,n,_,_=tree.ray_cast(Vector((-.08,.08,1)),Vector((0,0,-1)))
    propeller,pn,_,_=tree.ray_cast(Vector((-1,-.06,.28)),Vector((1,0,0)))
    assert antenna and propeller and abs(antenna.z-.23985)<.005 and abs(propeller.x+.07210)<.005
    bm.free()
    mat=body.data.materials[0]
    colors={'teal':(.02,.27,.32,1),'cyan':(.035,.70,.76,1),'amber':(1,.45,.025,1),'light':(.9,.85,.44,1),'dark':(.018,.08,.11,1)}
    parts=[]
    def piece(name,verts,faces,color,bone):
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
        attr=mesh.color_attributes.new(name='ToyColor',type='FLOAT_COLOR',domain='CORNER')
        for cell in attr.data:cell.color=colors[color]
        mesh.materials.append(mat)
        obj=bpy.data.objects.new(name,mesh);body.users_collection[0].objects.link(obj)
        obj.parent=rig;mod=obj.modifiers.new('原骨架蒙皮','ARMATURE');mod.object=rig
        group=obj.vertex_groups.new(name=bone);group.add(list(range(len(verts))),1,'REPLACE')
        parts.append(obj)
    def cylinder_z(name,x,y,z0,z1,r0,r1,color,bone,n=8):
        verts=[];faces=[]
        for z,r in ((z0,r0),(z1,r1)):
            for i in range(n):
                a=math.tau*i/n;verts.append((x+r*math.cos(a),y+r*math.sin(a),z))
        for i in range(n):faces.append((i,(i+1)%n,n+(i+1)%n,n+i))
        faces.extend([tuple(reversed(range(n))),tuple(n+i for i in range(n))])
        piece(name,verts,faces,color,bone)
    x,y,z=antenna
    cylinder_z('电动玩具_天线座',x,y,z-.012,z+.026,.039,.032,'teal','Shark_Head')
    cylinder_z('电动玩具_软天线',x,y,z+.025,z+.215,.009,.007,'cyan','Shark_Head',6)
    cylinder_z('电动玩具_信号灯',x,y,z+.19,z+.23,.022,.027,'amber','Shark_Head',8)
    # 两个小控制键让侧面读成装配外壳，而非真实动物皮肤。
    cylinder_z('电动玩具_按钮',x+.048,y-.055,z-.032,z+.018,.017,.019,'light','Shark_Head',8)
    px,py,pz=propeller
    def cylinder_x(name,x0,x1,r0,r1,color,n=10):
        verts=[];faces=[]
        for xx,r in ((x0,r0),(x1,r1)):
            for i in range(n):
                a=math.tau*i/n;verts.append((xx,py+r*math.cos(a),pz+r*math.sin(a)))
        for i in range(n):faces.append((i,(i+1)%n,n+(i+1)%n,n+i))
        faces.extend([tuple(reversed(range(n))),tuple(n+i for i in range(n))])
        piece(name,verts,faces,color,'Shark_Body_A')
    cylinder_x('电动玩具_螺旋桨外壳',px+.009,px-.049,.057,.072,'teal')
    ring=[];faces=[];n=12;rx=px-.055
    for r in (.079,.059):
        for i in range(n):
            a=math.tau*i/n;ring.append((rx,py+r*math.cos(a),pz+r*math.sin(a)))
    for i in range(n):faces.append((i,(i+1)%n,n+(i+1)%n,n+i))
    piece('电动玩具_螺旋桨护圈',ring,faces,'cyan','Shark_Body_A')
    verts=[];faces=[]
    for j in range(4):
        a=j*math.pi/2+.20
        for r,shift in ((.014,-.24),(.052,.34)):
            aa=a+shift;verts.extend([(px-.061,py+r*math.cos(aa-.19),pz+r*math.sin(aa-.19)),
                                  (px-.061,py+r*math.cos(aa+.19),pz+r*math.sin(aa+.19))])
        i=j*4;faces.extend([(i,i+1,i+3,i+2),(i+2,i+3,i+1,i)])
    piece('电动玩具_四叶螺旋桨',verts,faces,'amber','Shark_Body_A')
    cylinder_x('电动玩具_螺旋桨轴心',px-.052,px-.069,.015,.016,'light',8)
    return parts,{'antenna_anchor':list(antenna),'propeller_anchor':list(propeller),
                  'antenna_contact_error':abs(z-.23985),'propeller_contact_error':abs(px+.07210),
                  'toy_hardware_parts':len(parts)}

def main():
    global rig
    bpy.ops.wm.open_mainfile(filepath=str(APPROVED))
    rig=bpy.data.objects['Shark_Rig'];rig.data.pose_position='POSE'
    rig.animation_data_create();rest={b.name:[list(row) for row in b.matrix_local] for b in rig.data.bones}
    body=bpy.data.objects['Shark_Mesh'];details=[o for o in bpy.data.objects if o.type=='MESH' and o!=body]
    repair_jaw_weights(body);teeth_audit=remove_sharp_teeth(body)
    hardware,hardware_audit=add_toy_hardware(body,rig);details+=hardware
    transfer_detail_weights(body,details)
    for obj in (body,*details):
        attr=obj.data.color_attributes.get('ToyColor')
        if attr:attr.name='Color'
    for material in body.data.materials:
        for node in material.node_tree.nodes:
            if node.type=='VERTEX_COLOR':node.layer_name='Color'
        # 与 Cocos 标准材质兼容，避免额外的透明／清漆扩展。
        material.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=0
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (body,*details):obj.select_set(True)
    bpy.context.view_layer.objects.active=body;bpy.ops.object.join();body.name='Shark_Mesh'
    for layer in list(body.data.uv_layers):body.data.uv_layers.remove(layer)
    swim=bpy.data.actions['Shark_Swim_Loop'];build_actions(rig,swim)
    assert rest=={b.name:[list(row) for row in b.matrix_local] for b in rig.data.bones}
    weight_error=max(abs(sum(g.weight for g in v.groups)-1) for v in body.data.vertices)
    assert weight_error<1e-5
    scene=bpy.context.scene;scene.render.fps=24;scene.frame_start=1;scene.frame_end=25
    scene['D_作者源']='已认可的原鲨鱼玩具化版本；由 real-shark-toy-study 提升；旧圆头版仅 archive 追溯'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE));export('--apply' in sys.argv)
    body.data.calc_loop_triangles()
    jaw=body.vertex_groups['Shark_Jaw'].index
    report={'approved_source':'real-shark-toy-study/Shark_Original_Toy_Study.blend',
      'approved_source_sha256':hashlib.sha256(APPROVED.read_bytes()).hexdigest(),
      'bones':7,'rest_matrices_unchanged':True,'vertices':len(body.data.vertices),
      'triangles':len(body.data.loop_triangles),'meshes':1,'materials':1,'textures':0,
      'blender_bounds':[[min(v.co[i] for v in body.data.vertices) for i in range(3)],[max(v.co[i] for v in body.data.vertices) for i in range(3)]],
      'contact_seconds':.09,'clip_seconds':10/24,'jaw_weighted_vertices':sum(any(g.group==jaw and g.weight>0 for g in v.groups) for v in body.data.vertices),
      'contact_kind':'inflatable_body_bump','jaw_motion_degrees':0,'impact_seconds':.09,'overshoot_seconds':.13,
      'weight_sum_max_error':weight_error,'detail_weights':'父壳三角面重心插值','parts':[],
      **teeth_audit,**hardware_audit}
    (HERE/'source-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('原鲨鱼正式接入源导出完成',json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    if '--export-only' in sys.argv:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE));export('--apply' in sys.argv)
    else:main()
