"""只读核对源稿及实际GLB，不接触用户打开的 Blender 场景。"""
from pathlib import Path
import bpy,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'modelresource/entertainment/timed-water-balloon/TimedWaterBalloon.blend'
RUNTIME=ROOT/'assets/race/items/TimedWaterBalloon.glb'
report={}
for label,path in [('source',SOURCE),('runtime',RUNTIME)]:
 if label=='source': bpy.ops.wm.open_mainfile(filepath=str(path))
 else:
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=str(path))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 assert {o.name for o in meshes}=={'BalloonBody','BalloonConnector'}
 for o in meshes:o.data.calc_loop_triangles()
 triangles=sum(len(o.data.loop_triangles) for o in meshes)
 assert triangles==696
 materials={m.name for o in meshes for m in o.data.materials}
 assert len(materials)==1
 images=[i for i in bpy.data.images if i.size[0]>0 and i.type=='IMAGE']
 assert any(tuple(i.size)==(512,512) for i in images)
 body=bpy.data.objects['BalloonBody']; connector=bpy.data.objects['BalloonConnector']
 bounds=lambda o:(min((o.matrix_world@v.co).z for v in o.data.vertices),max((o.matrix_world@v.co).z for v in o.data.vertices))
 low,high=bounds(body);cLow,cHigh=bounds(connector)
 assert abs(high-.58)<1e-5 and abs(cHigh-.14)<1e-5
 assert abs(cHigh-low-.012)<1e-5
 report[label]={'triangles':triangles,'meshes':len(meshes),'materials':len(materials),'bodyHeightRange':[low,high], 'connectorHeightRange':[cLow,cHigh], 'contactOverlap':cHigh-low}
report['bytes']=RUNTIME.stat().st_size
report['sha256']=hashlib.sha256(RUNTIME.read_bytes()).hexdigest()
(ROOT/'modelresource/entertainment/timed-water-balloon/blender-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
