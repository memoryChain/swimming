"""移除两组仰泳旗及悬绳、支杆；--sync 仅重建池岸道具批次。"""
import importlib.util
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parents[1]
EDITABLE = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend'
MASTER = ROOT / 'sceneresource/SwimmingVenue_Rebuild_FlatColor.blend'
PREFIX = 'PoolsideProp_FlagLine'


def main():
    sync = '--sync' in sys.argv
    assert Path(bpy.data.filepath).resolve() == (MASTER if sync else EDITABLE)
    if not sync:
        objects = [o for o in bpy.data.objects if o.name.startswith(PREFIX)]
        assert len(objects) in (0, 34), len(objects)
        triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects if o.type == 'MESH')
        assert triangles in (0, 424), triangles
        for obj in objects:
            mesh = obj.data if obj.type == 'MESH' else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh is not None and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        assert not any(o.name.startswith(PREFIX) for o in bpy.data.objects)
        report = {'removedObjects': len(objects), 'removedTriangles': triangles}
    else:
        with bpy.data.libraries.load(str(EDITABLE), link=False) as (available, _):
            assert not any(n.startswith(PREFIX) for n in available.objects)
            names = [n for n in available.objects if n.startswith(('PoolsideProp_', 'Prototype_'))]
        assert len(names) == 242, len(names)
        spec = importlib.util.spec_from_file_location('venue_join', Path(__file__).with_name('simplify-venue-first-pass.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # 删除两端旗线会收缩整批 X 边界；Join 仍逐项验证源/合批世界边界一致。
        report = module.join_sources(bpy.data.objects['PoolsideProps_Merged'], EDITABLE, names, allow_bounds_change=True)
        assert report['triangles'] == 4680, report
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
