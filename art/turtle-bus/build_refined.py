"""参考图驱动的 Blender 配方；连续闭合形体、独立鳍轴、精确握点。"""
from pathlib import Path
import sys,json,math,argparse
import bpy
from mathutils import Vector,Matrix
sys.path.insert(0,str(Path(__file__).resolve().parent))
from mesh_builder import MeshBuilder
ROOT=Path(__file__).resolve().parents[2];ART=ROOT/'art/turtle-bus'
# 作者色板统一采用 sRGB；由 MeshBuilder 转为线性，避免绿色被误提亮成粉灰色。
# 冷白、橙色、蓝色与岸边水炮共用色值，龟壳与皮肤保留绿色身份。
# 绿色各分区比首轮鲜明版降低约10%的HSV饱和度，保留色相与明度。
PALETTE={'shell':(.0775,.46,.307,1),'scute':(.136,.64,.388,1),'light':(.291,.75,.462,1),
 'seam':(.0505,.28,.19,1),'rim':(.90,.97,1,1),'skin':(.341,.80,.467,1),
 'skin_dark':(.115,.43,.259,1),'belly':(.90,.97,1,1),'eye':(.015,.06,.055,1),'glint':(1,1,1,1),
 'orange':(1,.38,.035,1),'white':(.90,.97,1,1),'grip':(.035,.18,.32,1),
 'strap':(.04,.38,.82,1),'rope':(.78,.86,.91,1)}
# X前、Y横、Z上；所有尺寸均为世界单位，不随赛程缩放。
LAYOUT={'ringForward':[-2.85,-3.5,-3.5,-2.85],'ringLateral':[-2.85,-.95,.95,2.85],
 'majorRadius':.51,'tubeRadius':.19,'gripForward':-.90,'gripLateral':.21,
 'gripHeight':.23,'bodyHalfLength':1.72,'bodyHalfWidth':1.03,
 'harnessForward':-.94,'harnessLateral':.54,'harnessHeight':.38,'passengerRootBack':2.2}
B=None
# 预览输出写入独立目录，确认形体后才更新运行时与正式作者源。
OUTPUT=ART
RUNTIME=ROOT/'assets/scripts/core'

def loft(name,profiles,color,group,sides=12):
    vertices=[];faces=[];colors=[]
    for x,w,z,h in profiles:
        for i in range(sides):
            a=i*math.tau/sides;vertices.append((x,w*math.cos(a),z+h*math.sin(a)))
    for j in range(len(profiles)-1):
        for i in range(sides):
            a=j*sides+i;b=j*sides+(i+1)%sides
            faces.append((a,b,b+sides,a+sides));colors.append('belly' if i>=sides//2 else color)
    faces.extend([tuple(reversed(range(sides))),tuple((len(profiles)-1)*sides+i for i in range(sides))])
    colors.extend([color,color]);return B.mesh(name,vertices,faces,colors,group)

def shell_z(x,y):return .18+.45*math.sqrt(max(0,1-((x+.12)/1.15)**2-(y/.80)**2))

def build_shell():
    n=20;vertices=[];faces=[];colors=[]
    rings=[(.035,None),(.25,None),(.53,None),(.76,None),(.93,None),(1,.20),(.98,.085),(.86,-.09)]
    for r,z in rings:
        for i in range(n):
            a=i*math.tau/n;x=-.12+1.15*r*math.cos(a);y=.80*r*math.sin(a)
            vertices.append((x,y,shell_z(x,y) if z is None else z))
    faces.append(tuple(reversed(range(n))));colors.append('scute')
    for j in range(len(rings)-1):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
            colors.append('belly' if j==6 else 'rim' if j==5 else
                          ('scute' if j<3 else 'shell'))
    faces.append(tuple((len(rings)-1)*n+i for i in range(n)));colors.append('belly')
    shell=B.mesh('Carapace_Continuous_Rim_Plastron',vertices,faces,colors,'body')
    def surface(x,y):
        hit,p,_,_=shell.ray_cast(Vector((x,y,2)),Vector((0,0,-1)));assert hit
        return p.z+.002
    for x in (-.62,-.10,.42):
        path=[]
        for i in range(7):
            y=-.62+i*(1.24/6);xx=x+.07*abs(y)/.62;path.append((xx,y,surface(xx,y)))
        B.tube('Shell_Seam',path,.008,'seam','body',4)
    for side in (-1,1):
        path=[]
        for i in range(13):
            x=-.92+i*(1.6/12);y=side*(.24+.035*math.cos((x+.1)*math.tau/.52))
            path.append((x,y,surface(x,y)))
        B.tube('Shell_Longitudinal_Seam',path,.008,'seam','body',4)

def build_head():
    # 颈根仍嵌入原壳前缘；颊部向前延续，短钝喙不再收成尖锥。
    # 最大前伸仍为 1.73，保留整体尺度和玩法包络。
    head=loft('Head_Continuous_Neck_Beak',[(.82,.22,.11,.14),(1.02,.26,.145,.205),
         (1.22,.335,.215,.255),(1.48,.33,.205,.245),(1.68,.25,.17,.18),
         (1.73,.185,.155,.135)],'skin','body')
    for side in (-1,1):
        def surface(x,z,offset=.003):
            hit,p,_,_=head.ray_cast(Vector((x,side*2,z)),Vector((0,-side,0)));assert hit
            return (x,p.y+side*offset,z)
        # 大约增大三成眼部，保持平静友好的眉弧；深色眼面按头部表面落位。
        B.tube('Upper_Eyelid',[surface(1.245,.323),surface(1.325,.355),surface(1.425,.331)],.018,'skin_dark','body',4)
        vertices=[surface(1.335+.084*math.cos(i*math.tau/8),.295+.058*math.sin(i*math.tau/8)) for i in range(8)]
        vertices.append(surface(1.335,.295,-.012))
        faces=[tuple(range(8))]+[(i,(i+1)%8,8) for i in range(8)]
        B.mesh('Inset_Eye',vertices,faces,['eye']*len(faces),'body')
        glint=[surface(1.299,.311,.01),surface(1.328,.323,.01),surface(1.331,.300,.01),surface(1.32,.311,-.01)]
        B.mesh('Eye_Glint',glint,[(0,1,2),(0,3,1),(1,3,2),(2,3,0)],['glint']*4,'body')
        B.tube('Small_Smile',[surface(1.46,.115),surface(1.55,.094),surface(1.65,.098),
            surface(1.71,.12)],.010,'skin_dark','body',4)
        # 两枚克制的鼻孔嵌入喙面，不额外增加渲染节点。
        nose=[surface(1.671,.246,.004),surface(1.694,.250,.004),surface(1.683,.232,.004),
            surface(1.683,.243,-.008)]
        B.mesh('Nostril',nose,[(0,1,2),(0,3,1),(1,3,2),(2,3,0)],['skin_dark']*4,'body')
    loft('Tail',[(-1.05,.11,.04,.07),(-1.4,.075,0,.055),(-1.56,.009,-.01,.012)],'skin_dark','body',8)

def build_fin(side,front):
    path=([(.59,.56,.11,.35),(.57,.85,.075,.50),(.27,1.24,.015,.49),
           (-.16,1.59,-.025,.35),(-.49,1.81,-.045,.08)] if front else
          [(-.85,.50,.035,.26),(-1.03,.78,.015,.34),(-1.34,1.0,-.025,.25),(-1.54,1.09,-.04,.045)])
    # 肩根保留原轴与嵌入区；沿展向减薄，消除旧版恒厚截面的板片感。
    # 不增加截面、网格或动作节点，前缘饱满、后缘收薄由原六点截面承担。
    thickness=[1.80,1.38,.90,.48,.18] if front else [1.55,1.08,.60,.18]
    verts=[];faces=[];colors=[]
    for i,(x,y,z,w) in enumerate(path):
        a=path[max(0,i-1)];b=path[min(len(path)-1,i+1)];dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
        for lateral,height in [(-.5,0),(-.12,.065),(.5,0),(.40,-.027),(-.08,-.055),(-.42,-.025)]:
            verts.append((x-dy/length*w*lateral,side*(y+dx/length*w*lateral),z+height*thickness[i]))
        if i:
            for k in range(6):
                a=(i-1)*6+k;b=(i-1)*6+(k+1)%6
                faces.append((a,b,b+6,a+6));colors.append('skin' if k<2 else 'belly' if k in (3,4) else 'skin_dark')
    faces.extend([tuple(reversed(range(6))),tuple((len(path)-1)*6+k for k in range(6))]);colors+=['skin_dark']*2
    group=('front' if front else 'rear')+('Left' if side<0 else 'Right')
    B.mesh(group,verts,faces,colors,group,(path[0][0],side*path[0][1],path[0][2]))

def build_harness():
    for side in (-1,1):
        shell=bpy.data.objects['Carapace_Continuous_Rim_Plastron']
        path=[]
        for x,y in [(-.88,side*.54),(-.80,side*.46),(-.72,side*.26),(-.68,0)]:
            hit,p,_,_=shell.ray_cast(Vector((x,y,2)),Vector((0,0,-1)));assert hit
            path.append((x,y,p.z+.018))
        vertices=[]
        for x,y,z in path:vertices.extend([(x-.065,y,z-.018),(x+.065,y,z-.018),(x+.065,y,z+.018),(x-.065,y,z+.018)])
        faces=[]
        for i in range(len(path)-1):
            for k in range(4):
                a=i*4+k;b=i*4+(k+1)%4;faces.append((a,b,b+4,a+4))
        faces.extend([(3,2,1,0),tuple((len(path)-1)*4+k for k in range(4))])
        B.mesh('Soft_Harness',vertices,faces,['strap']*len(faces),'body')
        B.tube('Harness_Eye',[(-.90,side*.50,.37),(-1.0,side*.54,.37),(-.91,side*.60,.37)],.045,'orange','body')

def grip_foot(side, delta):
    x=-.59;y=side*LAYOUT['gripLateral']+delta
    hit,p,_,_=bpy.data.objects['Ring_Continuous_Inflatable'].ray_cast(Vector((x,y,1)),Vector((0,0,-1)))
    assert hit,('握带根部缺少圈面',x,y)
    return (x,y,p.z-.015)

def build_ring():
    vertices=[];faces=[];colors=[];n=24;m=8
    for i in range(n):
        a=i*math.tau/n
        for j in range(m):
            b=j*math.tau/m;r=LAYOUT['majorRadius']+LAYOUT['tubeRadius']*math.cos(b)
            vertices.append((r*math.cos(a),r*math.sin(a),.02+LAYOUT['tubeRadius']*math.sin(b)))
    for i in range(n):
        for j in range(m):
            faces.append((i*m+j,((i+1)%n)*m+j,((i+1)%n)*m+(j+1)%m,i*m+(j+1)%m))
            colors.append('white' if i//3%2 else 'orange')
    B.mesh('Ring_Continuous_Inflatable',vertices,faces,colors,'ring')
    for side in (-1,1):
        y=side*LAYOUT['gripLateral'];x=LAYOUT['gripForward']
        # 后伸软握带为大头角色留出头部净空，两个根部仍嵌入圈体。
        B.tube('Grip_Handle',[grip_foot(side,-.075),(-.72,y-.095,.18),(x,y-.07,.23),
            (x-.015,y,.235),(x,y+.07,.23),(-.72,y+.095,.18),grip_foot(side,.075)],.03,'grip','ring')
    B.tube('Ring_Tow_Eye',[(.59,-.075,.13),(.71,0,.15),(.59,.075,.13)],.035,'grip','ring')
    B.tube('Air_Valve',[(.05,.53,.16),(.05,.53,.225)],.043,'grip','ring',6)

def audit_turtle_interfaces():
    """核对颈根、四鳍肩根与闭合龟壳相交，并覆盖正式摆鳍极值。"""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    shell=BVHTree.FromObject(bpy.data.objects['Carapace_Continuous_Rim_Plastron'],bpy.context.evaluated_depsgraph_get())
    def signed_gap(point):
        nearest,normal,_,distance=shell.find_nearest(point)
        return distance if (point-nearest).dot(normal)>=0 else -distance
    neck_gap=signed_gap(Vector((.82,0,.11)))
    assert neck_gap<-.01,('颈根未嵌入龟壳',neck_gap)
    report={'neckRootSignedGap':round(neck_gap,6),'finRoots':{}}
    for group in ('frontLeft','frontRight','rearLeft','rearRight'):
        obj=bpy.data.objects[group];pivot=Vector(obj['pivot']);amplitude=9 if group.startswith('front') else 5
        samples=[]
        for angle in (-amplitude,0,amplitude):
            rotation=Matrix.Rotation(math.radians(angle),3,'X')
            gaps=[signed_gap(pivot+rotation@(v.co-pivot)) for v in list(obj.data.vertices)[:6]]
            # 根截面既要有足够体积在壳内，也不能仅依靠一个尖角接触。
            embedded=sum(gap<-.005 for gap in gaps)
            assert embedded>=2,('鳍根接触不足',group,angle,gaps)
            samples.append({'degrees':angle,'embeddedRootVertices':embedded,'maxOverlap':round(-min(gaps),6)})
        report['finRoots'][group]=samples
    return report


def export_outline():
    """只导出大形体，沿连续顶点法线外扩；排除眼睛、壳缝、背带、圈和绳。"""
    groups={}
    body_names={'Carapace_Continuous_Rim_Plastron','Head_Continuous_Neck_Beak','Tail'}
    for obj in B.collection.objects:
        group=obj.get('runtime_group')
        if obj.name not in body_names and group not in ('frontLeft','frontRight','rearLeft','rearRight'):
            continue
        mesh=obj.data;mesh.calc_loop_triangles();pivot=Vector(obj.get('pivot',(0,0,0)))
        target=groups.setdefault(group,{'positions':[],'normals':[],'indices':[]})
        offset=len(target['positions'])//3
        for vertex in mesh.vertices:
            p=vertex.co-pivot;n=vertex.normal.normalized()
            assert n.length>.99,('描边缺少有效法线',obj.name,vertex.index)
            target['positions'] += [round(p.x,5),round(p.z,5),round(p.y,5)]
            target['normals'] += [round(n.x,6),round(n.z,6),round(n.y,6)]
        for tri in mesh.loop_triangles:
            target['indices'] += [offset+i for i in reversed(tri.vertices)]
    (RUNTIME/'TurtleBusOutlineGeometry.ts').write_text(
        '// Blender 离线导出的主轮廓与连续法线；不包含壳纹、眼睛、背带、圈和绳。\n'
        +'export const TURTLE_BUS_OUTLINE_GEOMETRY = '+json.dumps(groups,separators=(',',':'))+';\n',encoding='utf8')
    triangles=sum(len(g['indices'])//3 for g in groups.values())
    assert len(groups)==5 and triangles<=750,('描边预算超出',len(groups),triangles)
    return {'triangles':triangles,'drawCalls':5,'materials':1,'newEffects':0}


def export():
    groups={}
    for obj in B.collection.objects:
        if obj.type!='MESH':continue
        group=obj['runtime_group'];pivot=tuple(obj.get('pivot',(0,0,0)))
        target=groups.setdefault(group,{'positions':[],'colors':[],'indices':[],'pivot':[pivot[0],pivot[2],pivot[1]],'_lookup':{}})
        mesh=obj.data;mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            color=mesh.materials[mesh.polygons[tri.polygon_index].material_index].diffuse_color
            # 与水炮相同的 0.65～1.0 明暗范围，颜色离线烘入，运行时仍单材质无光照。
            light=.65+.35*max(0,tri.normal.dot(Vector((.2,-.35,.915)).normalized()))
            for index in reversed(tri.vertices):
                p=mesh.vertices[index].co-Vector(pivot)
                position=[round(p.x,4),round(p.z,4),round(p.y,4)]
                rgba=[round(color[k]*light,4) for k in range(3)]+[1];key=tuple(position+rgba)
                if key not in target['_lookup']:
                    target['_lookup'][key]=len(target['positions'])//3
                    target['positions']+=position;target['colors']+=rgba
                target['indices'].append(target['_lookup'][key])
    for target in groups.values():del target['_lookup']
    triangles=sum(len(g['indices'])//3*(4 if key in ('ring','rope') else 1) for key,g in groups.items())
    assert triangles<=4000,triangles
    body_points=[v.co for obj in B.collection.objects if obj.get('runtime_group') not in ('ring','rope') for v in obj.data.vertices]
    bounds=[[min(p[k] for p in body_points),max(p[k] for p in body_points)] for k in range(3)]
    from mathutils.bvhtree import BVHTree
    ring_obj=bpy.data.objects['Ring_Continuous_Inflatable']
    ring_bvh=BVHTree.FromObject(ring_obj,bpy.context.evaluated_depsgraph_get())
    contacts=[]
    for side in (-1,1):
        for delta in (-.075,.075):
            point=Vector(grip_foot(side,delta))
            distance=ring_bvh.find_nearest(point)[3]
            assert distance<.016,('握带根部未接触圈面',distance)
            contacts.append(round(distance,6))
    (OUTPUT/'model-audit.json').write_text(json.dumps({'triangles':triangles,'drawCalls':13,'materials':1,
        'outline':export_outline(),
        'paletteColorSpace':'sRGB','exportColorSpace':'linear','palette':PALETTE,'faceShadeRange':[.65,1.0],
        'turtleBounds':bounds,'turtleDimensions':[round(b-a,4) for a,b in bounds],
        'handleFootSurfaceDistances':contacts,'turtleInterfaces':audit_turtle_interfaces(),
        'layout':LAYOUT,'parts':B.audit()},indent=2)+'\n',encoding='utf8')
    (RUNTIME/'TurtleBusGeometry.ts').write_text('// Blender 离线导出；修改 art/turtle-bus/build_refined.py 后重新生成。\nexport const TURTLE_BUS_GEOMETRY = '+json.dumps(groups,separators=(',',':'))+';\n',encoding='utf8')
    (RUNTIME/'TurtleBusLayout.ts').write_text('// Blender 作者源同步导出的世界单位与接触锚点。\nexport const TURTLE_BUS_LAYOUT = '+json.dumps(LAYOUT,separators=(',',':'))+' as const;\n',encoding='utf8')

def main():
    global B,OUTPUT,RUNTIME
    parser=argparse.ArgumentParser(description='海龟同源建模；可先输出隔离预览。')
    parser.add_argument('--review-dir',type=Path,help='预览源、几何与审计的隔离输出目录')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if args.review_dir:
        OUTPUT=RUNTIME=args.review_dir.resolve();OUTPUT.mkdir(parents=True,exist_ok=True)
    # 后台专用空场景，保留的用户作者源由 Git 管理；不携带 Blender 默认立方体。
    bpy.ops.wm.read_factory_settings(use_empty=True)
    B=MeshBuilder(PALETTE)
    for stage in [build_shell,build_head,lambda:[build_fin(s,f) for f in (True,False) for s in (-1,1)],build_harness,build_ring]:
        stage();B.audit();print('阶段完成:',stage.__name__)
    template=B.tube('Rope_Template',[(i/5,0,-.065*math.sin(math.pi*i/5)) for i in range(6)],.024,'rope','rope')
    export()
    bpy.data.objects.remove(template,do_unlink=True)
    templates=[o for o in B.collection.objects if o.get('runtime_group')=='ring']
    for i,(x,y) in enumerate(zip(LAYOUT['ringForward'],LAYOUT['ringLateral'])):
        for src in templates:
            obj=src.copy();obj.data=src.data.copy();B.collection.objects.link(obj)
            obj.name=f'Circle{i}_{src.name}';obj.location=(x,y,0);obj['runtime_group']='authoring_only'
        anchor=(-.94,math.copysign(.54,y),.38);end=(x+.71,y,.15)
        path=[Vector(anchor).lerp(Vector(end),j/5)+Vector((0,0,-.09*math.sin(math.pi*j/5))) for j in range(6)]
        B.tube(f'Rope{i}',path,.024,'rope','authoring_only')
    for obj in templates:bpy.data.objects.remove(obj,do_unlink=True)
    for obj in B.collection.objects:obj.select_set(False)
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/'TurtleBus.blend'))
    print('TURTLE_BUS_MODEL_OK')

if __name__=='__main__':main()
