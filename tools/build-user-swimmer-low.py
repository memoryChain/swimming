from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SRC_GLB = ROOT / "assets" / "resources" / "models" / "UserSwimmer.glb"
OUT_GLB = ROOT / "assets" / "resources" / "models" / "UserSwimmerLow.glb"
OUT_BLEND = ROOT / "tools" / "UserSwimmerLow.blend"

TARGET_TRIANGLES = 52000


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def triangle_count(obj):
    if obj.type != "MESH":
        return 0
    return sum(len(poly.vertices) - 2 for poly in obj.data.polygons)


def decimate_skinned_meshes():
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    heavy_meshes = [obj for obj in mesh_objects if triangle_count(obj) > 10000]
    if not heavy_meshes:
        raise RuntimeError("No high-poly skinned mesh found")

    for obj in heavy_meshes:
        tris = triangle_count(obj)
        ratio = max(0.005, min(1.0, TARGET_TRIANGLES / tris))
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        decimate = obj.modifiers.new("RuntimeDecimate", "DECIMATE")
        decimate.ratio = ratio
        decimate.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        obj.select_set(False)
        print(f"DECIMATED {obj.name}: {tris} -> {triangle_count(obj)} ratio={ratio:.5f}")


def strip_editor_only_objects():
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_assets():
    OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        export_materials="EXPORT",
        export_apply=False,
    )


def main():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(SRC_GLB))
    decimate_skinned_meshes()
    strip_editor_only_objects()
    export_assets()
    total = sum(triangle_count(obj) for obj in bpy.context.scene.objects if obj.type == "MESH")
    print(f"EXPORTED {OUT_GLB} total_tris={total}")


if __name__ == "__main__":
    main()
