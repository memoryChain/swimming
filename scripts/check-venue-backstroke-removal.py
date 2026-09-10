"""对比移除仰泳旗前后的 GLB；传入备份 GLB 路径，不修改资产。"""
import json,struct,pathlib,hashlib,sys
from collections import Counter
root=pathlib.Path(__file__).resolve().parents[1];out=root/'temp/venue-backstroke-removal';out.mkdir(parents=True,exist_ok=True)
if len(sys.argv)!=2: raise SystemExit('用法：python scripts/check-venue-backstroke-removal.py <优化前GLB路径>')
backup=pathlib.Path(sys.argv[1])
def load(p):
 b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);return j,b[28+n:],len(b)
def view(j,b,i):
 v=j['bufferViews'][i];return b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
def acc(j,b,i):
 a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']];size={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a['componentType']]*{'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]; off=a.get('byteOffset',0); buf=view(j,b,a['bufferView']);stride=v.get('byteStride',size)
 return b''.join(buf[off+k*stride:off+k*stride+size] for k in range(a['count']))
a,ab,asz=load(backup);c,cb,csz=load(root/'assets/race/pool/LowPolyPool.glb')
an={n['name']:n for n in a['nodes']};cn={n['name']:n for n in c['nodes']};assert an.keys()==cn.keys()
changed={'PoolsideProps_Merged'}
rows=[]
for name,n in cn.items():
 prev=an[name]
 for k in ['matrix','translation','rotation','scale']:assert n.get(k)==prev.get(k),(name,k)
 if 'mesh' not in n:continue
 old=a['meshes'][prev['mesh']]['primitives'];new=c['meshes'][n['mesh']]['primitives'];assert len(old)==len(new),(name,'primitive')
 tris=lambda j,ps:sum(j['accessors'][p['indices']]['count']//3 for p in ps)
 rows.append({'name':name,'before':tris(a,old),'after':tris(c,new)})
 for p,q in zip(old,new):
  assert a['materials'][p['material']]['name']==c['materials'][q['material']]['name'],name
  if name not in changed:
   assert p['attributes'].keys()==q['attributes'].keys(),name
   for key in p['attributes']:assert acc(a,ab,p['attributes'][key])==acc(c,cb,q['attributes'][key]),(name,key)
   assert acc(a,ab,p['indices'])==acc(c,cb,q['indices']),(name,'indices')
images=lambda j,b:{i['name']:hashlib.sha256(view(j,b,i['bufferView'])).hexdigest() for i in j['images']}
assert images(a,ab)==images(c,cb),'内嵌图片发生变化'
assert {r['name']:r['after'] for r in rows if r['name'] in changed}=={'PoolsideProps_Merged':4680}
assert sum(r['before']-r['after'] for r in rows)==424
# 对修改批次逐三角核验：其余道具几何保留，删除部分只能落在两条旗线。
def geometry(j,b,node):
 result=Counter()
 for primitive in j['meshes'][node['mesh']]['primitives']:
  positions=list(struct.iter_unpack('<fff',acc(j,b,primitive['attributes']['POSITION'])))
  index=primitive['indices'];fmt={5121:'B',5123:'H',5125:'I'}[j['accessors'][index]['componentType']]
  indices=[v[0] for v in struct.iter_unpack('<'+fmt,acc(j,b,index))]
  for i in range(0,len(indices),3):
   triangle=tuple(sorted(tuple(round(v,4) for v in positions[k]) for k in indices[i:i+3]))
   result[triangle]+=1
 return result
old_geometry=geometry(a,ab,an['PoolsideProps_Merged'])
new_geometry=geometry(c,cb,cn['PoolsideProps_Merged'])
assert not new_geometry-old_geometry,'剩余道具几何被改动'
removed=old_geometry-new_geometry
assert sum(removed.values())==424
for triangle in removed:
 assert any(all(abs(vertex[0]-x)<0.5 for vertex in triangle) for x in (5,45)),'删除了旗线之外的几何'

report={'beforeBytes':asz,'afterBytes':csz,'beforeTriangles':sum(r['before'] for r in rows),'afterTriangles':sum(r['after'] for r in rows),'nodes':len(c['nodes']),'meshes':len(c['meshes']),'primitives':sum(len(m['primitives']) for m in c['meshes']),'embeddedImagesUnchanged':len(c['images']),'unchangedMeshesVerified':len(rows)-1,'changed':[r for r in rows if r['name'] in changed]}
(out/'glb-report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report,indent=2))
