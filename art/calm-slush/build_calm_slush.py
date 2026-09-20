"""Build the low-poly Calm Slush pickup and export it for Cocos Creator."""

from __future__ import annotations

import base64
import json
import math
from pathlib import Path

import bmesh
import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
BLEND_PATH = SCRIPT_DIR / "CalmSlush.blend"
GLTF_PATH = PROJECT_ROOT / "assets" / "race" / "items" / "CalmSlush.gltf"
COLOR_ATTRIBUTE = "Color"

ICE = (0.48, 0.92, 1.0, 1.0)
ICE_LIGHT = (0.82, 0.99, 1.0, 1.0)
ICE_SHADOW = (0.16, 0.62, 0.86, 1.0)
NAVY = (0.025, 0.13, 0.30, 1.0)
WHITE = (0.96, 1.0, 1.0, 1.0)


class MeshBuilder:
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.colors = []

    def append(self, vertices, faces, color):
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(offset + index for index in face) for face in faces)
        self.colors.extend([color] * len(faces))

    def rings(self, rings, segments, colors):
        vertices = []
        for z, radius_x, radius_y in rings:
            for index in range(segments):
                angle = math.tau * index / segments
                vertices.append((math.cos(angle) * radius_x, math.sin(angle) * radius_y, z))
        faces = [tuple(reversed(range(segments))), tuple(range((len(rings) - 1) * segments, len(rings) * segments))]
        face_colors = [colors[0], colors[-1]]
        for ring_index in range(len(rings) - 1):
            lower = ring_index * segments
            upper = lower + segments
            for index in range(segments):
                next_index = (index + 1) % segments
                faces.append((lower + index, lower + next_index, upper + next_index, upper + index))
                face_colors.append(colors[min(ring_index, len(colors) - 1)])
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(offset + index for index in face) for face in faces)
        self.colors.extend(face_colors)

    def box(self, center, size, color, angle=0.0):
        cx, cy, cz = center
        hx, hy, hz = (axis * 0.5 for axis in size)
        cosine, sine = math.cos(angle), math.sin(angle)
        vertices = []
        for x, y, z in [
            (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
            (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
        ]:
            vertices.append((cx + x * cosine - z * sine, cy + y, cz + x * sine + z * cosine))
        self.append(vertices, [
            (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
            (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
        ], color)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    collection = bpy.data.collections.new("CalmSlush")
    bpy.context.scene.collection.children.link(collection)
    return collection


def make_material():
    material = bpy.data.materials.new("CalmSlushVertexColor")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = COLOR_ATTRIBUTE
    if "Metallic" in shader.inputs:
        shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = 0.78
    links.new(vertex_color.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def build_model(collection):
    builder = MeshBuilder()
    builder.rings([
        (-0.56, 0.25, 0.22),
        (-0.48, 0.31, 0.27),
        (0.13, 0.36, 0.31),
        (0.22, 0.39, 0.34),
    ], 10, [NAVY, ICE_SHADOW, ICE, ICE_LIGHT])
    builder.rings([
        (0.20, 0.40, 0.35),
        (0.28, 0.42, 0.37),
        (0.34, 0.34, 0.30),
        (0.47, 0.24, 0.22),
        (0.56, 0.10, 0.09),
    ], 10, [NAVY, ICE_LIGHT, ICE, WHITE, WHITE])
    builder.box((0.12, 0.02, 0.70), (0.10, 0.10, 0.40), NAVY, angle=-0.18)

    # Raised snowflake marks on both broad faces stay readable while the cup rotates.
    for face_y in (-0.325, 0.325):
        for angle in (0.0, math.pi / 3, -math.pi / 3):
            builder.box((0, face_y, -0.08), (0.055, 0.035, 0.38), WHITE, angle=angle)

    mesh = bpy.data.meshes.new("CalmSlushMesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update(calc_edges=True)
    colors = mesh.color_attributes.new(name=COLOR_ATTRIBUTE, type="BYTE_COLOR", domain="CORNER")
    mesh.color_attributes.active_color = colors
    for polygon, color in zip(mesh.polygons, builder.colors):
        for loop_index in polygon.loop_indices:
            colors.data[loop_index].color_srgb = color
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate(verbose=True)

    obj = bpy.data.objects.new("CalmSlush", mesh)
    collection.objects.link(obj)
    obj.data.materials.append(make_material())
    obj["asset_role"] = "calm_slush_pickup"
    obj["runtime_budget"] = "single mesh, single material, vertex colors"
    return obj


def validate(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    triangles = len(mesh.loop_triangles)
    if triangles > 320:
        raise RuntimeError(f"Triangle budget failed: {triangles}")
    if len(obj.material_slots) != 1 or COLOR_ATTRIBUTE not in mesh.color_attributes:
        raise RuntimeError("Calm Slush must use one vertex-color material")
    return {"vertices": len(mesh.vertices), "polygons": len(mesh.polygons), "triangles": triangles}


def export_gltf(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    GLTF_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLTF_PATH), export_format="GLTF_SEPARATE", use_selection=True,
        export_materials="EXPORT", export_vertex_color="ACTIVE",
        export_vertex_color_name=COLOR_ATTRIBUTE, export_all_vertex_colors=True,
        export_active_vertex_color_when_no_material=True, export_apply=True, export_yup=True,
    )
    payload = json.loads(GLTF_PATH.read_text(encoding="utf-8"))
    for buffer in payload.get("buffers", []):
        uri = buffer.get("uri", "")
        if uri and not uri.startswith("data:"):
            binary_path = GLTF_PATH.parent / uri
            buffer["uri"] = "data:application/octet-stream;base64," + base64.b64encode(binary_path.read_bytes()).decode("ascii")
            binary_path.unlink()
    GLTF_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return {"file_bytes": GLTF_PATH.stat().st_size}


def main():
    collection = reset_scene()
    obj = build_model(collection)
    report = {"validation": validate(obj)}
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    report["export"] = export_gltf(obj)
    print("CALM_SLUSH_BUILD_REPORT=" + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
