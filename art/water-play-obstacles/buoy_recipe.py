"""气球浮标配方：两网格、同一顶点色材质，尺寸及接触锚点采用 Cocos 米制。"""
import math
from model_tools import Builder

CYAN=(.025,.60,.70,1);WHITE=(.94,.97,.90,1);DARK=(.02,.18,.26,1)
ORANGE=(1,.61,.075,1);YELLOW=(1,.86,.13,1)
PROFILE=[(.61,.025),(.66,.065),(.74,.16),(.85,.255),(.99,.31),(1.13,.30),(1.25,.23),(1.33,.125),(1.355,.015)]
CX=-.22

def box(builder,center,half,color,yaw=0):
    start=len(builder.vertices);c,s=math.cos(yaw),math.sin(yaw)
    for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
        x*=half[0];y*=half[1];z*=half[2]
        builder.vertices.append((center[0]+x*c-z*s,center[1]+y,center[2]+x*s+z*c))
    for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        builder.faces.append(tuple(start+i for i in f));builder.colors.append(color)

def tube(builder,points,radius,color):
    # 环段连续桥接，端点直接来自扣座与气球结口；不由几根相交短柱拼接。
    start=len(builder.vertices);n=6
    for x,y,z in points:
        for i in range(n):
            a=math.tau*i/n;builder.vertices.append((x+math.cos(a)*radius,y,z+math.sin(a)*radius))
    for j in range(len(points)-1):
        for i in range(n):
            builder.faces.append(tuple(start+k for k in (j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)));builder.colors.append(color)
    for ids in [range(n-1,-1,-1),range((len(points)-1)*n,len(points)*n)]:
        builder.faces.append(tuple(start+i for i in ids));builder.colors.append(color)

def radius_at(y):
    for (y0,r0),(y1,r1) in zip(PROFILE,PROFILE[1:]):
        if y0<=y<=y1:return r0+(r1-r0)*(y-y0)/(y1-y0)
    raise ValueError('印花超出气球范围')

def patch(builder,outline,color,side,offset):
    # 警示徽记沿二十边球面贴合，内层埋入表皮，形成连接完整的浅浮雕。
    pts=[(sum(x for x,y in outline)/len(outline),sum(y for x,y in outline)/len(outline)),*outline]
    start=len(builder.vertices);n=len(pts)
    for depth in [-.008,offset+.003]:
        for x,y in pts:
            r=radius_at(y);local=x-CX
            xs=[r*math.cos(math.tau*i/20) for i in range(11)]
            zs=[r*math.sin(math.tau*i/20) for i in range(11)]
            z=None
            for i in range(10):
                if xs[i+1]-1e-8<=local<=xs[i]+1e-8:
                    t=(local-xs[i+1])/(xs[i]-xs[i+1]);z=zs[i+1]+(zs[i]-zs[i+1])*t;break
            assert z is not None,'印花越过轮廓'
            builder.vertices.append((x,y,side*(z+depth)))
    for i in range(1,n):
        nxt=1+i%(n-1)
        for f in [(0,nxt,i),(n,n+i,n+nxt),(i,nxt,n+nxt,n+i)]:
            builder.faces.append(tuple(start+j for j in f));builder.colors.append(color)

def build_buoy(root,mat):
    body=Builder()
    body.lathe([(-.13,.45),(-.10,.57),(-.045,.61),(.025,.61),(.115,.52),(.14,.18)],[DARK,WHITE,WHITE,CYAN,CYAN],segments=16,ellipse=.985)
    body.lathe([(-.035,.585),(-.005,.66),(.06,.66),(.11,.605),(.085,.565),(-.035,.565)],ORANGE,segments=20,ellipse=.985)
    # 四个软边分区在已有表面赋色，几何不增加独立渲染器。
    for i in range(len(body.faces)-102,len(body.faces)-2):
        if i>=0 and (i-(len(body.faces)-102))%20 in (0,5,10,15):body.colors[i]=WHITE
    body.lathe([(.12,.18),(.18,.15),(.245,.13),(.25,.085),(.155,.085)],WHITE,segments=12)
    body.lathe([(.15,.084),(.162,.084)],DARK,segments=12)
    # 导水槽为盘面内切低槽：降低同一个顶面扇区，槽底深青色。
    for index in (1,5,9,13):
        for ring in (4,5):
            k=ring*16+index;x,y,z=body.vertices[k];body.vertices[k]=(x,y-.015,z)
        body.colors[4*16+(index-1)%16]=DARK
    body.lathe([(.10,.07),(.16,.065),(.205,.04)],WHITE,center=(-.32,0,.05),segments=8)
    body.lathe([(.188,.038),(.21,.032)],DARK,center=(-.32,0,.05),segments=8)
    base=body.object('BuoyBody',mat,root)
    balloon=Builder()
    tether=[(-.32,.195,.05),(-.30,.30,.075),(-.25,.41,.06),(-.21,.52,.015),(CX,.625,0)]
    tube(balloon,tether,.019,WHITE)
    balloon.lathe([(.585,.04),(.615,.026),(.65,.04)],ORANGE,center=(CX,0,0),segments=8)
    balloon.lathe(PROFILE,YELLOW,center=(CX,0,0),segments=20)
    for side in [1,-1]:
        star=[(CX+math.cos(math.tau*i/12)*(.224 if i%2==0 else .17),1.035+math.sin(math.tau*i/12)*(.206 if i%2==0 else .157)) for i in range(12)]
        patch(balloon,star,WHITE,side,.025)
        # 水滴与感叹号用闭合的浅色面，不依赖字体或透明贴图。
        patch(balloon,[(CX-.085,1.155),(CX-.145,1.06),(CX-.145,1.015),(CX-.11,.98),(CX-.055,.98),(CX-.025,1.02),(CX-.03,1.065)],CYAN,side,.042)
        patch(balloon,[(CX+.055,1.16),(CX+.11,1.16),(CX+.102,1.025),(CX+.062,1.025)],DARK,side,.042)
        patch(balloon,[(CX+.06,.998),(CX+.104,.998),(CX+.104,.958),(CX+.06,.958)],DARK,side,.042)
    top=balloon.object('BuoyBalloon',mat,root)
    # 可动组件以实际扣座为原点，摆动和压缩时系带下端不会滑离连接处。
    anchor=(-.32,.195,.05)
    for vertex in top.data.vertices:
        vertex.co.x-=anchor[0];vertex.co.y+=anchor[2];vertex.co.z-=anchor[1]
    top.location=(anchor[0],-anchor[2],anchor[1])
    return [base,top],dict(sprayOrigin=[0,.25,0],tetherAnchor=[-.32,.195,.05],balloonCenter=[CX,1.0,0],visibleRadii=[.66,.6501],contacts={'rimBodyOverlap':.045,'nozzleBodyOverlap':.02,'tetherSocketOverlap':.015,'tetherKnotOverlap':.025,'knotBalloonOverlap':.04},balloonHeight=1.355)
