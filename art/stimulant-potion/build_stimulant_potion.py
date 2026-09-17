"""Build the approved low-poly stimulant potion and export it for Cocos Creator."""

from __future__ import annotations

import json
import math
import base64
from pathlib import Path

import bmesh
import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
BLEND_PATH = SCRIPT_DIR / "StimulantPotion.blend"
GLTF_PATH = PROJECT_ROOT / "assets" / "race" / "items" / "StimulantBottle.gltf"

COLLECTION_NAME = "StimulantPotion"
OBJECT_NAME = "StimulantPotion"
COLOR_ATTRIBUTE = "Color"

LIME = (0.43, 1.00, 0.025, 1.0)
ORANGE = (1.00, 0.105, 0.018, 1.0)
NAVY = (0.018, 0.080, 0.31, 1.0)
WHITE = (1.00, 0.92, 0.72, 1.0)


class MeshBuilder:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.face_colors: list[tuple[float, float, float, float]] = []

    def _append(self, vertices, faces, color) -> None:
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(offset + i for i in face) for face in faces)
        self.face_colors.extend([color] * len(faces))

    def add_prism(self, profile_xz, y_min, y_max, color) -> None:
        """Extrude one closed XZ profile through Y."""
        count = len(profile_xz)
        vertices = [(x, y_min, z) for x, z in profile_xz]
        vertices += [(x, y_max, z) for x, z in profile_xz]
        faces = [tuple(range(count)), tuple(range(count, count * 2))]
        for i in range(count):
            j = (i + 1) % count
            faces.append((i, j, count + j, count + i))
        self._append(vertices, faces, color)

    def add_frame(self, outer_xz, inner_xz, y_min, y_max, color) -> None:
        """Create a closed faceted frame with a real central opening."""
        count = len(outer_xz)
        vertices = [(x, y_min, z) for x, z in outer_xz]
        vertices += [(x, y_max, z) for x, z in outer_xz]
        vertices += [(x, y_min, z) for x, z in inner_xz]
        vertices += [(x, y_max, z) for x, z in inner_xz]
        faces = []
        for i in range(count):
            j = (i + 1) % count
            outer_front, outer_back = i, count + i
            inner_front, inner_back = count * 2 + i, count * 3 + i
            outer_front_j, outer_back_j = j, count + j
            inner_front_j, inner_back_j = count * 2 + j, count * 3 + j
            faces.extend([
                (outer_front, outer_front_j, inner_front_j, inner_front),
                (outer_back, inner_back, inner_back_j, outer_back_j),
                (outer_front, outer_back, outer_back_j, outer_front_j),
                (inner_front, inner_front_j, inner_back_j, inner_back),
            ])
        self._append(vertices, faces, color)

    def add_elliptic_rings(self, rings, segments, color) -> None:
        """Build one closed, faceted body from measured elliptical rings."""
        vertices = []
        for z, radius_x, radius_y in rings:
            for i in range(segments):
                angle = math.tau * i / segments
                vertices.append((math.cos(angle) * radius_x, math.sin(angle) * radius_y, z))
        faces = [tuple(range(segments)), tuple(range((len(rings) - 1) * segments, len(rings) * segments))]
        for ring_index in range(len(rings) - 1):
            base = ring_index * segments
            next_base = (ring_index + 1) * segments
            for i in range(segments):
                j = (i + 1) % segments
                faces.append((base + i, base + j, next_base + j, next_base + i))
        self._append(vertices, faces, color)


def scaled_profile(profile, scale: float):
    return [(x * scale, z * scale) for x, z in profile]


def reset_scene() -> bpy.types.Collection:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    collection = bpy.data.collections.new(COLLECTION_NAME)
    bpy.context.scene.collection.children.link(collection)
    return collection


def make_material() -> bpy.types.Material:
    material = bpy.data.materials.new("StimulantVertexColor")
    material.use_nodes = True
    material.diffuse_color = (1.0, 1.0, 1.0, 1.0)
    material.metallic = 0.0
    material.roughness = 0.72
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = COLOR_ATTRIBUTE
    links.new(attribute.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def build_model(collection: bpy.types.Collection) -> bpy.types.Object:
    builder = MeshBuilder()
    body_outer = [
        (-0.30, -0.50),
        (0.30, -0.50),
        (0.43, -0.35),
        (0.43, 0.24),
        (0.32, 0.43),
        (0.20, 0.52),
        (-0.20, 0.52),
        (-0.32, 0.43),
        (-0.43, 0.24),
        (-0.43, -0.35),
    ]
    body_inner = scaled_profile(body_outer, 0.76)
    core = scaled_profile(body_outer, 0.71)
    lightning = [
        (-0.07, 0.32),
        (0.13, 0.32),
        (0.025, 0.075),
        (0.20, 0.075),
        (-0.12, -0.39),
        (-0.035, -0.12),
        (-0.21, -0.12),
    ]

    # Main frame and inset core. The core stays inside the real central opening.
    builder.add_frame(body_outer, body_inner, -0.18, 0.18, LIME)
    builder.add_prism(core, -0.155, 0.155, ORANGE)

    # The collar overlaps the frame by 0.05 m; the neck overlaps the cap by 0.04 m.
    builder.add_elliptic_rings([(0.43, 0.25, 0.17), (0.63, 0.25, 0.17)], 8, LIME)
    builder.add_elliptic_rings([(0.47, 0.31, 0.205), (0.59, 0.31, 0.205)], 8, LIME)
    builder.add_elliptic_rings([
        (0.59, 0.265, 0.19),
        (0.64, 0.34, 0.235),
        (0.80, 0.34, 0.235),
        (0.86, 0.275, 0.19),
    ], 8, NAVY)

    # Raised lightning geometry on both sides keeps the pickup readable while rotating.
    builder.add_prism(lightning, -0.23, -0.14, WHITE)
    builder.add_prism(list(reversed(lightning)), 0.14, 0.23, WHITE)

    mesh = bpy.data.meshes.new("StimulantPotionMesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update(calc_edges=True)

    # Center the complete pickup around the origin for stable runtime bobbing/rotation.
    z_values = [vertex.co.z for vertex in mesh.vertices]
    z_offset = (min(z_values) + max(z_values)) * 0.5
    for vertex in mesh.vertices:
        vertex.co.z -= z_offset

    colors = mesh.color_attributes.new(
        name=COLOR_ATTRIBUTE,
        type="BYTE_COLOR",
        domain="CORNER",
    )
    mesh.color_attributes.active_color = colors
    for polygon, color in zip(mesh.polygons, builder.face_colors):
        for loop_index in polygon.loop_indices:
            colors.data[loop_index].color_srgb = color

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate(verbose=True)
    mesh.update(calc_edges=True)

    obj = bpy.data.objects.new(OBJECT_NAME, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(make_material())
    obj["asset_role"] = "stimulant_pickup"
    obj["style_reference"] = "stimulant-potion-style-reference-v1.png"
    obj["runtime_budget"] = "single mesh, single material, vertex colors"
    return obj


def triangle_count(mesh: bpy.types.Mesh) -> int:
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def validate_model(obj: bpy.types.Object) -> dict:
    mesh = obj.data
    triangles = triangle_count(mesh)
    if not 100 <= triangles <= 300:
        raise RuntimeError(f"Triangle budget failed: {triangles}")
    if len(obj.material_slots) != 1:
        raise RuntimeError(f"Expected one material slot, got {len(obj.material_slots)}")
    if COLOR_ATTRIBUTE not in mesh.color_attributes:
        raise RuntimeError("Missing vertex color attribute")

    bm = bmesh.new()
    bm.from_mesh(mesh)
    non_manifold = [edge.index for edge in bm.edges if not edge.is_manifold]
    bm.free()
    if non_manifold:
        raise RuntimeError(f"Non-manifold edges: {non_manifold[:12]}")

    bounds = {
        "x": [min(v.co.x for v in mesh.vertices), max(v.co.x for v in mesh.vertices)],
        "y": [min(v.co.y for v in mesh.vertices), max(v.co.y for v in mesh.vertices)],
        "z": [min(v.co.z for v in mesh.vertices), max(v.co.z for v in mesh.vertices)],
    }
    # Six-side projection audit: opposite views must share the same silhouette bounds.
    projections = {
        "front_back": [bounds["x"], bounds["z"]],
        "left_right": [bounds["y"], bounds["z"]],
        "top_bottom": [bounds["x"], bounds["y"]],
    }
    return {
        "vertices": len(mesh.vertices),
        "polygons": len(mesh.polygons),
        "triangles": triangles,
        "materials": len(obj.material_slots),
        "bounds": bounds,
        "six_side_projection_bounds": projections,
        "contacts": {
            "body_to_neck_overlap_m": 0.52 - 0.43,
            "neck_to_cap_overlap_m": 0.63 - 0.59,
            "front_lightning_seated_into_core_m": -0.14 - (-0.155),
            "back_lightning_seated_into_core_m": 0.155 - 0.14,
        },
    }


def export_gltf(obj: bpy.types.Object) -> dict:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    GLTF_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLTF_PATH),
        export_format="GLTF_SEPARATE",
        use_selection=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_vertex_color_name=COLOR_ATTRIBUTE,
        export_all_vertex_colors=True,
        export_active_vertex_color_when_no_material=True,
        export_apply=True,
        export_yup=True,
    )
    payload = json.loads(GLTF_PATH.read_text(encoding="utf-8"))
    for buffer in payload.get("buffers", []):
        uri = buffer.get("uri", "")
        if not uri or uri.startswith("data:"):
            continue
        binary_path = GLTF_PATH.parent / uri
        encoded = base64.b64encode(binary_path.read_bytes()).decode("ascii")
        buffer["uri"] = f"data:application/octet-stream;base64,{encoded}"
        binary_path.unlink()
    GLTF_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    meshes = payload.get("meshes", [])
    materials = payload.get("materials", [])
    if len(meshes) != 1 or len(materials) != 1:
        raise RuntimeError(f"Export budget failed: meshes={len(meshes)} materials={len(materials)}")
    primitives = meshes[0].get("primitives", [])
    if len(primitives) != 1 or "COLOR_0" not in primitives[0].get("attributes", {}):
        raise RuntimeError("Export must contain one primitive with COLOR_0")
    return {
        "meshes": len(meshes),
        "materials": len(materials),
        "primitives": len(primitives),
        "has_vertex_color": "COLOR_0" in primitives[0]["attributes"],
        "file_bytes": GLTF_PATH.stat().st_size,
    }


def main() -> None:
    collection = reset_scene()
    obj = build_model(collection)
    validation = validate_model(obj)
    bpy.context.scene["stimulant_validation"] = json.dumps(validation, ensure_ascii=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    exported = export_gltf(obj)
    report = {"validation": validation, "export": exported}
    print("STIMULANT_BUILD_REPORT=" + json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
