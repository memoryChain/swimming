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

import math
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
    "PoolsideProps_Merged",
)

BLEACHER_ATLAS_MATERIAL = "BleacherFlatColorAtlas_Material"
POOLSIDE_PROPS_ATLAS_MATERIAL = "PoolsidePropsFlatColorAtlas_Material"
POOLSIDE_PROPS_ATLAS_VERSION_PROPERTY = "poolside_props_flat_color_atlas_version"
EXPECTED_POOLSIDE_PROPS_ATLAS_VERSION = 8
EXPECTED_BLEACHER_BATCHES = 17
MAX_EXPORT_PRIMITIVES = 39

# Poolside props are authored around the two long pool edges and the two
# backstroke lines. A bad one-off merge once baked object-space Y into world Z:
# the triangle/material counts still passed, but almost every prop vanished from
# the runtime camera. Keep deliberately loose placement guards so normal art
# iteration remains possible while an axis swap or missing transform is rejected.
POOLSIDE_BOUNDS_RANGES = (
    ((4.5, 5.5), (44.5, 45.5)),       # world X: two backstroke lines
    ((-16.5, -13.5), (14.5, 16.5)),   # world Y: two long pool edges
    ((-1.05, -0.8), (2.3, 2.6)),      # world Z: grounded submerged ladder to chair top
)
POOLSIDE_TRIANGLE_RANGE = (5000, 8000)
POOLSIDE_DECK_GROUND_Z = 0.2
POOLSIDE_MIN_GROUNDED_VERTICES = 150
POOLSIDE_LADDER_GROUND_CENTERS = (
    (14.0, 10.8),
    (36.0, 10.8),
    (14.0, -10.8),
    (36.0, -10.8),
)
POOLSIDE_MIN_LADDER_GROUNDED_VERTICES = 12

# --- Baked arena dimming (replaces the runtime per-pixel VenueHeightShade) -----
# The stands / walls / structure darken with world height and horizontal distance
# from the pool. This is a fixed scene with fixed lighting, so the gradient is
# baked once into per-vertex COLOR_0 and multiplied by the unlit material at
# runtime (StandHeightShade.ts / VenueHeightShade.effect). The bleacher atlas,
# exit "lamps" and the dark soffit stay bright (white) so their authored colours
# are unchanged. Curve values match the old VenueHeightShade shadeCurve.
# export_yup maps Blender (x, y, z) -> Cocos (x, z, -y): height = Blender z, and
# the pool plane is Blender (x, y) with Cocos |Z| == |Blender y|.
SHADE_COLOR_ATTR = "venueShade"
SHADE_STAND_KEYWORDS = (
    "bleacher",
    "grandstand",
    "stand",
    "corner",
    "olympicpanel",
    "platform",
)
SHADE_ATLAS_MATERIAL = BLEACHER_ATLAS_MATERIAL.lower()
SHADE_EXIT_KEYWORD = "emergencyexit"
SHADE_SOFFIT_KEYWORD = "upper_tier_soffit_dark"
SHADE_POOL_MIN_X = 0.0
SHADE_POOL_MAX_X = 50.0
SHADE_POOL_HALF_Y = 10.5
SHADE_NEAR_KEEP = 6.0
# Brighter poolside baseline + very dark top, with a ~linear height curve so the
# darkening is spread across the WHOLE height (a small gamma crushes the whole
# upper stand to one dark value and the gradient becomes invisible).
SHADE_BOTTOM = 0.78
SHADE_TOP = 0.04
SHADE_HEIGHT_CURVE = 1.0
SHADE_DIST_CURVE = 1.0
# Walls/soffit dim IN STEP with the authored seating tiers instead of a single
# bottom->top line (which left T2 walls too white while T2 seating was already
# dark). Index 1 (T2) is where the wall starts dimming; lower it to darken the
# wall from T2 up. Kept below the seats' TIER_BRIGHTNESS[1]=0.55.
SHADE_TIER_VALUES = (1.0, 0.42, 0.24, 0.10)
# Far-from-pool floor for the distance term. A tall back wall's BASE has a low z
# (so the tier curve alone calls it "near pool / bright"), but it actually sits
# far behind the seating and must read dark. We take the darker of tier(height)
# and distance so high OR far both go dark; the poolside front row stays bright.
SHADE_DIST_MIN = 0.45


def _shade_is_stand(name):
    lower = name.lower()
    return any(keyword in lower for keyword in SHADE_STAND_KEYWORDS)


def _shade_pool_distance(x, y):
    if x < SHADE_POOL_MIN_X:
        dx = SHADE_POOL_MIN_X - x
    elif x > SHADE_POOL_MAX_X:
        dx = x - SHADE_POOL_MAX_X
    else:
        dx = 0.0
    ay = abs(y)
    dy = ay - SHADE_POOL_HALF_Y if ay > SHADE_POOL_HALF_Y else 0.0
    return math.hypot(dx, dy)


def _shade_face_dims(obj, polygon):
    # Atlas bleacher faces, exit lamps and the dark soffit stay bright (white).
    if polygon.material_index >= len(obj.material_slots):
        return True
    material = obj.material_slots[polygon.material_index].material
    if material is None:
        return True
    name = material.name.lower()
    if name == SHADE_ATLAS_MATERIAL:
        return False
    if SHADE_EXIT_KEYWORD in name or SHADE_SOFFIT_KEYWORD in name:
        return False
    return True


def bake_vertex_shade(meshes):
    # Pass 1: tier z-centres from the bleacher batches so walls/soffit dim in step
    # with the authored seating tiers (T1 bright poolside ... T4 darkest) rather
    # than a single bottom->top line that left T2 walls too white.
    tier_centers = []
    for tier in range(1, 5):
        lo, hi = math.inf, -math.inf
        for obj in meshes:
            if f"bleacherbatch_t{tier}" in obj.name.lower():
                matrix = obj.matrix_world
                for vertex in obj.data.vertices:
                    z = (matrix @ vertex.co).z
                    lo = min(lo, z)
                    hi = max(hi, z)
        tier_centers.append((lo + hi) * 0.5 if math.isfinite(lo) else None)
    known = [(index, center) for index, center in enumerate(tier_centers) if center is not None]
    if not known:
        tier_centers = [0.0, 1.5, 3.0, 4.5]
    else:
        for index in range(4):
            if tier_centers[index] is None:
                nearest_index, nearest_center = min(known, key=lambda kc: abs(kc[0] - index))
                tier_centers[index] = nearest_center + (index - nearest_index) * 1.5

    def tier_brightness(z):
        # Walls/soffit start at the T2 tone: the wall/base BELOW the seating must not
        # be brighter than the seats. A bright T1 base made the corner back walls
        # (whose base is not hidden by front seating) look pale next to the T2 walls.
        if z <= tier_centers[1]:
            return SHADE_TIER_VALUES[1]
        if z >= tier_centers[-1]:
            return SHADE_TIER_VALUES[-1]
        for i in range(1, len(tier_centers) - 1):
            lower_z = tier_centers[i]
            upper_z = tier_centers[i + 1]
            if lower_z <= z <= upper_z:
                t = (z - lower_z) / max(1e-4, upper_z - lower_z)
                return SHADE_TIER_VALUES[i] + (SHADE_TIER_VALUES[i + 1] - SHADE_TIER_VALUES[i]) * t
        return SHADE_TIER_VALUES[-1]

    # Horizontal distance range over stand geometry, for the distance dimming.
    max_dist = 0.0
    for obj in meshes:
        if not _shade_is_stand(obj.name):
            continue
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            world = matrix @ vertex.co
            max_dist = max(max_dist, _shade_pool_distance(world.x, world.y))
    span_dist = max(1e-4, max_dist - SHADE_NEAR_KEEP)

    def dist_brightness(dist):
        t = max(0.0, min(1.0, (dist - SHADE_NEAR_KEEP) / span_dist))
        return 1.0 - (1.0 - SHADE_DIST_MIN) * t

    # Pass 2: write per-corner COLOR_0 brightness on stand geometry only. Non-stand
    # meshes (pool / water / lane floats / podium) keep their own materials and
    # never sample vertex colour, so adding COLOR_0 there only bloats the GLB.
    baked_stands = 0
    for obj in meshes:
        if not _shade_is_stand(obj.name):
            continue
        # Give shared meshes their own data so each instance bakes with its own
        # world transform instead of inheriting a sibling's colours.
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        mesh = obj.data
        existing = mesh.color_attributes.get(SHADE_COLOR_ATTR)
        if existing is not None:
            mesh.color_attributes.remove(existing)
        layer = mesh.color_attributes.new(
            name=SHADE_COLOR_ATTR, type="FLOAT_COLOR", domain="CORNER"
        )
        baked_stands += 1
        matrix = obj.matrix_world
        for polygon in mesh.polygons:
            dims = _shade_face_dims(obj, polygon)
            for loop_index in polygon.loop_indices:
                if dims:
                    world = matrix @ mesh.vertices[mesh.loops[loop_index].vertex_index].co
                    # Darker of (height tier, horizontal distance): a high seat OR a
                    # far-back wall both go dark, so a corner back wall's low base is
                    # dimmed to match the straight back wall instead of reading as a
                    # bright near-pool surface.
                    brightness = min(
                        tier_brightness(world.z),
                        dist_brightness(_shade_pool_distance(world.x, world.y)),
                    )
                else:
                    brightness = 1.0
                layer.data[loop_index].color = (brightness, brightness, brightness, 1.0)
        # Make it the active render colour so the glTF exporter emits COLOR_0.
        for index, attribute in enumerate(mesh.color_attributes):
            if attribute.name == SHADE_COLOR_ATTR:
                mesh.color_attributes.active_color_index = index
                mesh.color_attributes.render_color_index = index
                break
        mesh.update()
    return baked_stands


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


def validate_poolside_geometry(obj):
    world_vertices = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    if not world_vertices:
        raise RuntimeError("PoolsideProps_Merged has no vertices")
    bounds = tuple(
        (min(vertex[axis] for vertex in world_vertices), max(vertex[axis] for vertex in world_vertices))
        for axis in range(3)
    )
    for axis, ((minimum_low, minimum_high), (maximum_low, maximum_high)) in enumerate(
        POOLSIDE_BOUNDS_RANGES
    ):
        minimum, maximum = bounds[axis]
        if not minimum_low <= minimum <= minimum_high or not maximum_low <= maximum <= maximum_high:
            raise RuntimeError(
                "PoolsideProps_Merged bounds indicate a broken merge/axis transform: "
                f"axis={axis} bounds={bounds}"
            )
    triangles = sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)
    if not POOLSIDE_TRIANGLE_RANGE[0] <= triangles <= POOLSIDE_TRIANGLE_RANGE[1]:
        raise RuntimeError(
            "PoolsideProps_Merged triangle count is outside the approved static-prop range: "
            f"{triangles}"
        )
    grounded_vertices = sum(
        abs(vertex.z - POOLSIDE_DECK_GROUND_Z) <= 0.002 for vertex in world_vertices
    )
    if grounded_vertices < POOLSIDE_MIN_GROUNDED_VERTICES:
        raise RuntimeError(
            "PoolsideProps_Merged freestanding feet do not reach the deck ground: "
            f"z={POOLSIDE_DECK_GROUND_Z} groundedVertices={grounded_vertices} "
            f"expected>={POOLSIDE_MIN_GROUNDED_VERTICES}"
        )
    for ladder_index, (center_x, center_y) in enumerate(
        POOLSIDE_LADDER_GROUND_CENTERS, start=1
    ):
        ladder_grounded_vertices = sum(
            abs(vertex.z - POOLSIDE_DECK_GROUND_Z) <= 0.002
            and abs(vertex.x - center_x) <= 0.9
            and abs(vertex.y - center_y) <= 1.0
            for vertex in world_vertices
        )
        if ladder_grounded_vertices < POOLSIDE_MIN_LADDER_GROUNDED_VERTICES:
            raise RuntimeError(
                f"Poolside ladder {ladder_index} does not reach the deck ground: "
                f"groundedVertices={ladder_grounded_vertices} "
                f"expected>={POOLSIDE_MIN_LADDER_GROUNDED_VERTICES}"
            )


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

    prop_target = next((obj for obj in meshes if obj.name == "PoolsideProps_Merged"), None)
    if prop_target is None:
        raise RuntimeError("Missing renderable PoolsideProps_Merged")
    prop_used_indices = {polygon.material_index for polygon in prop_target.data.polygons}
    prop_used_names = {
        prop_target.material_slots[index].material.name
        for index in prop_used_indices
        if index < len(prop_target.material_slots) and prop_target.material_slots[index].material
    }
    if prop_used_names != {POOLSIDE_PROPS_ATLAS_MATERIAL}:
        raise RuntimeError(
            "PoolsideProps_Merged is not atlas-batched; run batch-flatcolor-venue.py first: "
            f"{sorted(prop_used_names)}"
        )
    prop_atlas_version = prop_target.get(POOLSIDE_PROPS_ATLAS_VERSION_PROPERTY)
    if prop_atlas_version != EXPECTED_POOLSIDE_PROPS_ATLAS_VERSION:
        raise RuntimeError(
            "PoolsideProps_Merged is using an obsolete full-bright atlas; "
            "run batch-flatcolor-venue.py first: "
            f"version={prop_atlas_version} expected={EXPECTED_POOLSIDE_PROPS_ATLAS_VERSION}"
        )
    validate_poolside_geometry(prop_target)

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

    # Bake the arena dimming into per-vertex COLOR_0 (was the runtime per-pixel
    # VenueHeightShade). Fixed scene / fixed lighting, so it is static now.
    baked_stands = bake_vertex_shade(exportable_meshes())

    export_kwargs = dict(
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
    # Emit the baked COLOR_0 even though no Blender material references it (the
    # runtime unlit shader consumes it). The parameter changed across versions.
    if bpy.app.version >= (4, 2, 0):
        export_kwargs["export_vertex_color"] = "ACTIVE"
    elif bpy.app.version >= (4, 0, 0):
        export_kwargs["export_all_vertex_colors"] = True
    else:
        export_kwargs["export_colors"] = True

    os.makedirs(os.path.dirname(output_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(**export_kwargs)
    print({
        "bakedStandMeshes": baked_stands,
        "output": output_glb,
        "bytes": os.path.getsize(output_glb),
        "source_primitives": primitive_count,
    })


if __name__ == "__main__":
    main()
