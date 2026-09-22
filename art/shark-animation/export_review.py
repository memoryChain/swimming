"""从实际作者骨架采样动作与顶点色；同时导出同造型的简化固定兜底网格。"""
import bpy, json, math, base64, struct, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[1]
bpy.ops.wm.open_mainfile(filepath=str(HERE/'SharkModel_bite_source.blend'))
rig=bpy.data.objects['Shark_Rig']; obj=bpy.data.objects['Shark_Mesh']; scene=bpy.context.scene
def action(name):
    a=bpy.data.actions[name]; rig.animation_data.action=a
    if a.slots: rig.animation_data.action_slot=a.slots[0]
def packed(values): return base64.b64encode(struct.pack('<'+'f'*len(values),*values)).decode()
action('Shark_Swim_Loop'); scene.frame_set(1); mesh=obj.data; mesh.calc_loop_triangles()
colors=mesh.color_attributes['Color']; keys={}; indices=[]; vertex_ids=[]; rgba=[]
for tri in mesh.loop_triangles:
    for li in tri.loops:
        vi=mesh.loops[li].vertex_index; c=tuple(colors.data[li].color)
        key=(vi,c)
        if key not in keys:
            keys[key]=len(vertex_ids); vertex_ids.append(vi)
            # 离线简易光照只作形体阅读，不代表引擎材质。
            n=mesh.vertices[vi].normal; light=.65+.35*max(0,n.dot(__import__('mathutils').Vector((-.4,-.5,.76)).normalized()))
            rgba.extend([min(1,max(0,x))**(1/2.2)*light for x in c[:3]]+[1])
        indices.append(keys[key])
data={'indices':indices,'colors':rgba,'frames':{},'frameTimes':{},'note':'实际作者骨架采样；独立简易光照，不是引擎录屏'}
audit={}
for name,duration in ([] if '--fallback-only' in sys.argv else [('Shark_Swim_Loop',1),('Shark_Bite',10/24),('Shark_Entry_Rise',1.1)]):
    action(name); times=sorted(set([i/24 for i in range(math.floor(duration*24)+1)]+[duration]+([.09] if name=='Shark_Bite' else [])))
    frames=[]; mins=[math.inf]*3; maxs=[-math.inf]*3; tail=[]
    for t in times:
        f=1+t*24; scene.frame_set(int(f),subframe=f%1)
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get()); em=evaluated.to_mesh()
        coords=[]
        for vi in vertex_ids:
            p=em.vertices[vi].co
            assert all(math.isfinite(c) for c in p)
            coords.extend((-p.y*1.6,p.z*1.6-.38,-p.x*1.6))
            for k in range(3): mins[k]=min(mins[k],p[k]); maxs[k]=max(maxs[k],p[k])
        frames.append(packed(coords)); tail.append(list(rig.pose.bones['Shark_Tail_Tip'].matrix.translation))
        evaluated.to_mesh_clear()
    data['frames'][name]=frames; data['frameTimes'][name]=times
    first=struct.unpack('<'+'f'*(len(base64.b64decode(frames[0]))//4),base64.b64decode(frames[0]))
    last=struct.unpack('<'+'f'*(len(base64.b64decode(frames[-1]))//4),base64.b64decode(frames[-1]))
    audit[name]={'samples':len(times),'seconds':duration,'bounds':[mins,maxs],'endpoint_max_delta':max(abs(a-b) for a,b in zip(first,last)),
                 'tail_x_range':max(v[0] for v in tail)-min(v[0] for v in tail),'non_finite':0}
if '--fallback-only' not in sys.argv:
    (HERE/'sampled-review.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
    (HERE/'animation-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
# 兜底为从同一作者源离线减面的固定几何，不在比赛时构建造型或重算网格。
action('Shark_Swim_Loop'); scene.frame_set(1)
fallback=obj.copy(); fallback.data=obj.data.copy(); scene.collection.objects.link(fallback)
fallback.modifiers.clear(); dec=fallback.modifiers.new('离线兜底减面','DECIMATE'); dec.ratio=.32
bpy.context.view_layer.objects.active=fallback; bpy.ops.object.modifier_apply(modifier=dec.name)
fm=fallback.data; fm.calc_loop_triangles(); colors=fm.color_attributes['Color']; ids={}; pp=[]; cc=[]; ii=[]
for tri in fm.loop_triangles:
    for li in tri.loops:
        v=fm.vertices[fm.loops[li].vertex_index]; color=tuple(round(c,3) for c in colors.data[li].color)
        key=(v.index,color)
        if key not in ids:
            ids[key]=len(pp)//3; pp.extend(round(c,4) for c in (v.co.x,v.co.z,-v.co.y)); cc.extend(color)
        ii.append(ids[key])
target=ROOT/'assets/scripts/core/SharkFallbackGeometry.ts'
target.write_text('// 由 art/shark-animation/export_review.py 从作者源离线生成；仅在模型未就绪时使用。\n'
    +'export const SHARK_FALLBACK_GEOMETRY = '+json.dumps({'positions':pp,'colors':cc,'indices':ii},separators=(',',':'))+';\n',encoding='utf8')
print('D_固定兜底已导出（跳过动作采样）' if '--fallback-only' in sys.argv else 'D_动作采样与固定兜底已导出',len(pp)//3,len(ii)//3)
