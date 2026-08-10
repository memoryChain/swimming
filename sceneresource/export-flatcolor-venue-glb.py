"""Export the clean FlatColor swimming venue to the runtime GLB.

SwimmingVenue_Rebuild_FlatColor.blend is the merged/export target, not the
editable source. Synchronize the editable venue into it, then run
batch-flatcolor-venue.py before exporting. This script rejects an unbatched
target instead of silently shipping its extra material primitives.

Headless usage:
    & "E:\\blender\\blender.exe" -b sceneresource\\SwimmingVenue_Rebuild_FlatColor.blend \\
        --python sceneresource\\export-flatcolor-venue-glb.py -- assets\\race\\pool\\LowPolyPool.glb

If OUTPUT is omitted it defaults to assets/race/pool/LowPolyPool.glb next to the repo root.
Can also be run from an already-open Blender (e.g. Blender MCP) by importing main().

Notes:
- Keep the existing LowPolyPool.glb.meta so PoolScene.prefab keeps referencing the model.
- After overwriting the GLB, let Cocos Creator reimport it, then run:
      npm run textures:fix
      npm run textures:check
"""

import os
import sys

import bpy

# Template/source objects that must never be exported (kept hidden in the blend).
SOURCE_OBJECTS = (
    "Bleacher_Module_Flat_Source",
    "Olympic_Panel_Source",
)

# Nodes the runtime looks up by name (RaceCourseLayout / StartBlockInstancer / binders).
REQUIRED_NODES = (
    "PoolWaterSurface",
    "pool_floor",
    "Venue_Rectangular_Ground",
    "pool_edge_batch",
    "pool_inner_wall_batch",
    "lane_float_rope_batch",
    "lane_floor_line_batch",
    "start_block_anchor_root",
    "start_block_anchor_near_01",
    "start_block_anchor_near_08",
    "start_block_top_near_marker",
)

BLEACHER_ATLAS_MATERIAL = "BleacherFlatColorAtlas_Material"
EXPECTED_BLEACHER_BATCHES = 17
MAX_EXPORT_PRIMITIVES = 39


def script_args():
    args = sys.argv
    if "--" not in args:
        return []
    return args[args.index("--") + 1:]


def default_output():
    # sceneresource/ -> repo root -> assets/race/pool/LowPolyPool.glb
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(repo_root, "assets", "race", "pool", "LowPolyPool.glb")


def exportable_meshes():
    return [
        obj for obj in bpy.data.objects
        if obj.type == "MESH" and not obj.hide_render and not obj.hide_get()
    ]


def validate_batching():
    meshes = exportable_meshes()
    bleachers = [
        obj for obj in meshes
        if obj.name.lower().startswith("bleacherbatch_")
        or obj.name.lower() == "cornerstands_merged"
    ]
    if len(bleachers) != EXPECTED_BLEACHER_BATCHES:
        raise RuntimeError(
            f"Expected {EXPECTED_BLEACHER_BATCHES} bleacher batches, found {len(bleachers)}"
        )
    unbatched = []
    for obj in bleachers:
        used_indices = {polygon.material_index for polygon in obj.data.polygons}
        used_names = {
            obj.material_slots[index].material.name
            for index in used_indices
            if index < len(obj.material_slots) and obj.material_slots[index].material
        }
        if used_names != {BLEACHER_ATLAS_MATERIAL}:
            unbatched.append((obj.name, sorted(used_names)))
    if unbatched:
        raise RuntimeError(
            "Bleachers are not atlas-batched; run batch-flatcolor-venue.py first: "
            f"{unbatched}"
        )

    primitive_count = sum(
        max(1, len({polygon.material_index for polygon in obj.data.polygons}))
        for obj in meshes
    )
    if primitive_count > MAX_EXPORT_PRIMITIVES:
        raise RuntimeError(
            f"Venue has {primitive_count} export primitives; expected <= {MAX_EXPORT_PRIMITIVES}"
        )
    return primitive_count


def main():
    args = script_args()
    output_glb = os.path.abspath(args[0]) if args else default_output()

    missing = [n for n in REQUIRED_NODES if bpy.data.objects.get(n) is None]
    if missing:
        raise RuntimeError(f"Missing required runtime objects: {missing}")

    # Ensure template source meshes are excluded from the export.
    for name in SOURCE_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            obj.hide_set(True)
            obj.hide_viewport = True
            obj.hide_render = True

    primitive_count = validate_batching()

    os.makedirs(os.path.dirname(output_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_glb,
        export_format="GLB",
        use_visible=True,
        use_renderable=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_unused_images=False,
        # Venue is flat/unlit color -> normals are dead weight (~40% of the GLB).
        # Drop them; merge coincident verts in-mesh instead. If any venue surface
        # ever needs real lighting, re-enable normals here.
        export_normals=False,
        export_tangents=False,
    )
    print({
        "output": output_glb,
        "bytes": os.path.getsize(output_glb),
        "source_primitives": primitive_count,
    })


if __name__ == "__main__":
    main()
