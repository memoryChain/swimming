"""参考图驱动的 Blender 配方；连续闭合形体、独立鳍轴、精确握点。"""
from pathlib import Path
import sys,json,math
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from mesh_builder import MeshBuilder
ROOT=Path(__file__).resolve().parents[2];ART=ROOT/'art/turtle-bus'
PALETTE={'shell':(.19,.46,.32,1),'scute':(.28,.56,.37,1),'light':(.37,.63,.42,1),
 'seam':(.105,.29,.23,1),'rim':(.81,.83,.57,1),'skin':(.42,.73,.58,1),
 'skin_dark':(.27,.55,.44,1),'belly':(.83,.86,.65,1),'eye':(.025,.065,.06,1),'glint':(.95,.98,.89,1),
 'orange':(1,.43,.13,1),'white':(.94,.93,.83,1),'grip':(.075,.20,.23,1),
 'strap':(.14,.32,.36,1),'rope':(.87,.79,.57,1)}
# X前、Y横、Z上；所有尺寸均为世界单位，不随赛程缩放。
LAYOUT={'ringForward':[-2.85,-3.5,-3.5,-2.85],'ringLateral':[-2.85,-.95,.95,2.85],
 'majorRadius':.51,'tubeRadius':.19,'gripForward':-.90,'gripLateral':.21,
 'gripHeight':.23,'bodyHalfLength':1.72,'bodyHalfWidth':1.03,
 'harnessForward':-.94,'harnessLateral':.54,'harnessHeight':.38,'passengerRootBack':2.2}
B=None

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
    rings=[(.035,None),(.25,None),(.53,None),(.76,None),(.93,None),(1,.17),(1,.08),(.86,-.09)]
    for r,z in rings:
        for i in range(n):
            a=i*math.tau/n;x=-.12+1.15*r*math.cos(a);y=.80*r*math.sin(a)
            vertices.append((x,y,shell_z(x,y) if z is None else z))
    faces.append(tuple(reversed(range(n))));colors.append('scute')
    for j in range(len(rings)-1):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
            colors.append('belly' if j==6 else 'rim' if j==5 else 'seam' if j==4 else
                          ('scute' if j<3 else 'shell'))
    faces.append(tuple((len(rings)-1)*n+i for i in range(n)));colors.append('belly')
    shell=B.mesh('Carapace_Continuous_Rim_Plastron',vertices,faces,colors,'body')
    def surface(x,y):
        hit,p,_,_=shell.ray_cast(Vector((x,y,2)),Vector((0,0,-1)));assert hit
        return p.z+.003
    for x in (-.62,-.10,.42):
        path=[]
        for i in range(7):
            y=-.62+i*(1.24/6);xx=x+.07*abs(y)/.62;path.append((xx,y,surface(xx,y)))
        B.tube('Shell_Seam',path,.012,'seam','body',4)
    for side in (-1,1):
        path=[]
        for i in range(13):
            x=-.92+i*(1.6/12);y=side*(.24+.035*math.cos((x+.1)*math.tau/.52))
            path.append((x,y,surface(x,y)))
        B.tube('Shell_Longitudinal_Seam',path,.012,'seam','body',4)

def build_head():
    head=loft('Head_Continuous_Neck_Beak',[(.82,.22,.11,.14),(1.02,.25,.13,.20),
         (1.22,.33,.20,.25),(1.48,.32,.20,.24),(1.68,.23,.15,.17),(1.73,.10,.12,.10)],'skin','body')
    for side in (-1,1):
        def surface(x,z,offset=.003):
            hit,p,_,_=head.ray_cast(Vector((x,side*2,z)),Vector((0,-side,0)));assert hit
            return (x,p.y+side*offset,z)
        B.tube('Upper_Eyelid',[surface(1.265,.30),surface(1.325,.326),surface(1.405,.30)],.017,'skin_dark','body')
        vertices=[surface(1.335+.065*math.cos(i*math.tau/8),.275+.043*math.sin(i*math.tau/8)) for i in range(8)]
        vertices.append(surface(1.335,.275,-.012))
        faces=[tuple(range(8))]+[(i,(i+1)%8,8) for i in range(8)]
        B.mesh('Inset_Eye',vertices,faces,['eye']*len(faces),'body')
        glint=[surface(1.305,.289,.01),surface(1.327,.299,.01),surface(1.329,.282,.01),surface(1.32,.289,-.01)]
        B.mesh('Eye_Glint',glint,[(0,1,2),(0,3,1),(1,3,2),(2,3,0)],['glint']*4,'body')
        B.tube('Small_Smile',[surface(1.48,.095),surface(1.61,.078),surface(1.70,.09)],.009,'skin_dark','body',4)
    loft('Tail',[(-1.05,.11,.04,.07),(-1.4,.075,0,.055),(-1.56,.009,-.01,.012)],'skin_dark','body',8)

def build_fin(side,front):
    path=([(.59,.56,.11,.35),(.57,.85,.075,.50),(.27,1.24,.015,.49),
           (-.16,1.59,-.025,.35),(-.49,1.81,-.045,.08)] if front else
          [(-.85,.50,.035,.26),(-1.03,.78,.015,.34),(-1.34,1.0,-.025,.25),(-1.54,1.09,-.04,.045)])
    verts=[];faces=[];colors=[]
    for i,(x,y,z,w) in enumerate(path):
        a=path[max(0,i-1)];b=path[min(len(path)-1,i+1)];dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
        for lateral,height in [(-.5,0),(0,.065),(.5,0),(.5,-.04),(0,-.055),(-.5,-.04)]:
            verts.append((x-dy/length*w*lateral,side*(y+dx/length*w*lateral),z+height))
        if i:
            for k in range(6):
                a=(i-1)*6+k;b=(i-1)*6+(k+1)%6
                faces.append((a,b,b+6,a+6));colors.append('skin' if k<2 else 'skin_dark')
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

def export():
    groups={}
    for obj in B.collection.objects:
        if obj.type!='MESH':continue
        group=obj['runtime_group'];pivot=tuple(obj.get('pivot',(0,0,0)))
        target=groups.setdefault(group,{'positions':[],'colors':[],'indices':[],'pivot':[pivot[0],pivot[2],pivot[1]],'_lookup':{}})
        mesh=obj.data;mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            color=mesh.materials[mesh.polygons[tri.polygon_index].material_index].diffuse_color
            light=.82+.18*max(0,tri.normal.dot(Vector((.2,-.35,.915)).normalized()))
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
    (ART/'model-audit.json').write_text(json.dumps({'triangles':triangles,'drawCalls':13,'materials':1,
        'turtleBounds':bounds,'turtleDimensions':[round(b-a,4) for a,b in bounds],
        'handleFootSurfaceDistances':contacts,'layout':LAYOUT,'parts':B.audit()},indent=2)+'\n',encoding='utf8')
    (ROOT/'assets/scripts/core/TurtleBusGeometry.ts').write_text('// Blender 离线导出；修改 art/turtle-bus/build_refined.py 后重新生成。\nexport const TURTLE_BUS_GEOMETRY = '+json.dumps(groups,separators=(',',':'))+';\n',encoding='utf8')
    (ROOT/'assets/scripts/core/TurtleBusLayout.ts').write_text('// Blender 作者源同步导出的世界单位与接触锚点。\nexport const TURTLE_BUS_LAYOUT = '+json.dumps(LAYOUT,separators=(',',':'))+' as const;\n',encoding='utf8')

def main():
    global B
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
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'TurtleBus.blend'))
    print('TURTLE_BUS_MODEL_OK')

if __name__=='__main__':main()
