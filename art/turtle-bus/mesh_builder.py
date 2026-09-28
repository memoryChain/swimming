"""离线网格工具；只管理本配方集合，不操作其他场景对象。"""
import math
import bpy
import bmesh
from mathutils import Vector

class MeshBuilder:
    def __init__(self, palette):
        old=bpy.data.collections.get('TurtleBusAuthoring')
        if old:
            for obj in list(old.objects): bpy.data.objects.remove(obj,do_unlink=True)
            bpy.data.collections.remove(old)
        self.collection=bpy.data.collections.new('TurtleBusAuthoring')
        bpy.context.scene.collection.children.link(self.collection)
        self.materials={}
        for name,color in palette.items():
            mat=bpy.data.materials.get('TB_'+name) or bpy.data.materials.new('TB_'+name)
            mat.diffuse_color=color;self.materials[name]=mat

    def mesh(self,name,vertices,faces,colors,group,origin=(0,0,0)):
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces)
        keys=list(dict.fromkeys(colors))
        for key in keys:mesh.materials.append(self.materials[key])
        for face,key in zip(mesh.polygons,colors):face.material_index=keys.index(key)
        bm=bmesh.new();bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
        obj=bpy.data.objects.new(name,mesh);self.collection.objects.link(obj)
        obj['runtime_group']=group;obj['pivot']=origin
        return obj

    def tube(self,name,path,radius,color,group,sides=6):
        vertices=[];faces=[]
        for i,p in enumerate(path):
            tangent=(Vector(path[min(len(path)-1,i+1)])-Vector(path[max(0,i-1)])).normalized()
            helper=Vector((0,0,1)) if abs(tangent.z)<.95 else Vector((0,1,0))
            u=tangent.cross(helper).normalized();v=tangent.cross(u).normalized()
            for k in range(sides):
                a=k*math.tau/sides;vertices.append(Vector(p)+radius*(math.cos(a)*u+math.sin(a)*v))
            if i:
                for k in range(sides):
                    a=(i-1)*sides+k;b=(i-1)*sides+(k+1)%sides
                    faces.append((a,b,b+sides,a+sides))
        faces.extend([tuple(reversed(range(sides))),tuple((len(path)-1)*sides+k for k in range(sides))])
        return self.mesh(name,vertices,faces,[color]*len(faces),group)

    def audit(self):
        report={}
        for obj in self.collection.objects:
            if obj.type!='MESH':continue
            bm=bmesh.new();bm.from_mesh(obj.data)
            boundary=sum(not e.is_manifold for e in bm.edges);volume=bm.calc_volume(signed=True);bm.free()
            if boundary or volume<=0:raise RuntimeError(f'{obj.name}: 边界={boundary}, 有向体积={volume}')
            report[obj.name]={'closed':True,'volume':round(volume,6)}
        return report
