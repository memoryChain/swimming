"""E 模型共享构建工具：配方使用 Cocos 米制坐标，源场景转换为 Blender Z 向上。"""
import bpy, bmesh, math
from mathutils import Vector

def material():
    mat=bpy.data.materials.new('PoolPlasticVertexColor'); mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value=.4
    color=mat.node_tree.nodes.new('ShaderNodeVertexColor'); color.layer_name='Color'
    mat.node_tree.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
    return mat

class Builder:
    def __init__(self): self.vertices=[]; self.faces=[]; self.colors=[]
    def lathe(self,rings,color,center=(0,0,0),axis='y',segments=20,ellipse=1):
        base=len(self.vertices)
        for height,radius in rings:
            for i in range(segments):
                a=math.tau*i/segments; u=radius*math.cos(a); v=radius*math.sin(a)*ellipse
                point=(u,height,v) if axis=='y' else (u,v,height)
                self.vertices.append(tuple(point[k]+center[k] for k in range(3)))
        for j in range(len(rings)-1):
            for i in range(segments):
                self.faces.append(tuple(base+x for x in (j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i)))
                self.colors.append(color[j] if isinstance(color,list) else color)
        self.faces.extend([tuple(base+i for i in reversed(range(segments))),tuple(base+(len(rings)-1)*segments+i for i in range(segments))])
        self.colors.extend([color[0] if isinstance(color,list) else color,color[-1] if isinstance(color,list) else color])
    def object(self,name,mat,parent):
        mesh=bpy.data.meshes.new(name+'Mesh')
        mesh.from_pydata([(x,-z,y) for x,y,z in self.vertices],[],self.faces);mesh.update()
        bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
        assert all(e.is_manifold for e in bm.edges), name+' 存在开放边'
        bm.to_mesh(mesh);bm.free()
        attr=mesh.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER');mesh.color_attributes.active_color=attr
        for p in mesh.polygons:
            for i in p.loop_indices: attr.data[i].color_srgb=self.colors[p.index]
        mesh.materials.append(mat)
        obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);obj.parent=parent
        return obj

def geometry(obj):
    mesh=obj.data;mesh.calc_loop_triangles();positions=[];colors=[];indices=[]
    attr=mesh.color_attributes.active_color; lookup={}
    for tri in mesh.loop_triangles:
        for loop in tri.loops:
            v=mesh.vertices[mesh.loops[loop].vertex_index].co
            p=tuple(round(x,5) for x in (v.x,v.z,-v.y));c=tuple(round(x,5) for x in attr.data[loop].color)
            key=p+c
            if key not in lookup:
                lookup[key]=len(positions)//3;positions.extend(p);colors.extend(c)
            indices.append(lookup[key])
    return dict(positions=positions,colors=colors,indices=indices)

def camera_at(position,target,scale):
    bpy.ops.object.camera_add(location=position);camera=bpy.context.object
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=scale;bpy.context.scene.camera=camera
    return camera
