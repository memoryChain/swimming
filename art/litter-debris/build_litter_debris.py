"""Build the two low-poly litter categories used by the runtime geometry recipe."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bmesh
import bpy


ROOT = Path(__file__).resolve().parent
BLEND_PATH = ROOT / "LitterDebris.blend"
GLB_PATH = ROOT / "LitterDebris.glb"
AUDIT_PATH = ROOT / "litter-debris-audit.json"
COLLECTION_NAME = "LitterDebris"
COLOR_ATTRIBUTE = "Color"


class Builder:
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.colors = []

    def append(self, vertices, faces, color):
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(offset + index for index in face) for face in faces)
        self.colors.extend([color] * len(faces))

    def box(self, lo, hi, color):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        vertices = [
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
        ]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3),
                 (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)]
        self.append(vertices, faces, color)

    def prism(self, profile, z_min, z_max, color):
        count = len(profile)
        vertices = [(x, y, z_min) for x, y in profile] + [(x, y, z_max) for x, y in profile]
        faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
        faces += [(index, (index + 1) % count, count + (index + 1) % count, count + index)
                  for index in range(count)]
        self.append(vertices, faces, color)

    def rings_x(self, rings, center_y, center_z, segments=10):
        for ring_index in range(len(rings) - 1):
            x0, radius0, color = rings[ring_index]
            x1, radius1, _ = rings[ring_index + 1]
            vertices = []
            for x, radius in ((x0, radius0), (x1, radius1)):
                vertices += [(x, center_y + math.cos(side / segments * math.tau) * radius,
                              center_z + math.sin(side / segments * math.tau) * radius)
                             for side in range(segments)]
            faces = []
            if ring_index == 0:
                faces.append(tuple(reversed(range(segments))))
            if ring_index == len(rings) - 2:
                faces.append(tuple(range(segments, segments * 2)))
            faces += [(side, (side + 1) % segments, segments + (side + 1) % segments, segments + side)
                      for side in range(segments)]
            self.append(vertices, faces, color)


def build_rigid():
    b = Builder()
    cola_dark = (0.24, 0.09, 0.035, 1)
    cola_light = (0.48, 0.22, 0.075, 1)
    label = (0.88, 0.055, 0.035, 1)
    label_light = (1, 0.82, 0.42, 1)
    cap = (0.72, 0.035, 0.025, 1)
    b.rings_x([
        (-0.46, 0.080, cap), (-0.405, 0.080, cap),
        (-0.385, 0.066, cola_dark), (-0.315, 0.075, cola_light),
        (-0.235, 0.135, cola_light), (-0.145, 0.155, cola_dark),
        (-0.105, 0.158, label), (0.145, 0.158, label),
        (0.185, 0.158, label_light), (0.315, 0.153, cola_dark),
        (0.415, 0.142, cola_dark), (0.455, 0.118, cola_dark),
    ], 0.055, 0, 10)
    return b


def build_soft():
    b = Builder()
    orange = (0.96, 0.43, 0.055, 1)
    yellow = (1, 0.78, 0.12, 1)
    red = (0.78, 0.045, 0.035, 1)
    dark = (0.30, 0.075, 0.035, 1)
    b.prism([(-0.42, -0.16), (-0.39, -0.235), (-0.27, -0.21), (-0.12, -0.245),
             (0.03, -0.215), (0.19, -0.24), (0.37, -0.20), (0.42, -0.10),
             (0.39, 0.19), (0.25, 0.235), (0.08, 0.215), (-0.08, 0.245),
             (-0.25, 0.215), (-0.39, 0.185)], -0.060, 0.060, orange)
    b.box((-0.37, 0.175, -0.064), (0.37, 0.225, 0.064), yellow)
    b.box((-0.35, -0.225, -0.064), (0.35, -0.175, 0.064), yellow)
    b.prism([(-0.21, -0.09), (0.18, -0.10), (0.25, 0.02),
             (0.17, 0.13), (-0.18, 0.12), (-0.25, 0.01)], 0.061, 0.078, red)
    b.prism([(-0.31, 0.13), (-0.27, 0.15), (-0.08, -0.13), (-0.13, -0.15)],
            0.061, 0.079, dark)
    b.prism([(0.16, 0.16), (0.20, 0.14), (0.32, -0.12), (0.27, -0.14)],
            0.061, 0.079, yellow)
    return b


def material():
    mat = bpy.data.materials.new("LitterVertexColor")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = COLOR_ATTRIBUTE
    shader.inputs["Roughness"].default_value = 0.78
    links.new(color.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return mat


def make_object(name, builder, collection, mat):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update(calc_edges=True)
    colors = mesh.color_attributes.new(name=COLOR_ATTRIBUTE, type="BYTE_COLOR", domain="CORNER")
    mesh.color_attributes.active_color = colors
    for polygon, face_color in zip(mesh.polygons, builder.colors):
        for loop_index in polygon.loop_indices:
            colors.data[loop_index].color_srgb = face_color
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate(verbose=True)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj["runtime_role"] = "rigid_bounce" if name == "RigidLitter" else "soft_drag"
    return obj


def audit_object(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    bounds = {axis: [min(getattr(v.co, axis) for v in mesh.vertices),
                     max(getattr(v.co, axis) for v in mesh.vertices)] for axis in "xyz"}
    bm = bmesh.new()
    bm.from_mesh(mesh)
    non_manifold = sum(1 for edge in bm.edges if not edge.is_manifold)
    bm.free()
    if non_manifold:
        raise RuntimeError(f"{obj.name}: {non_manifold} non-manifold edges")
    triangles = len(mesh.loop_triangles)
    if not 60 <= triangles <= 450:
        raise RuntimeError(f"{obj.name}: triangle budget {triangles}")
    return {"vertices": len(mesh.vertices), "triangles": triangles, "bounds": bounds,
            "materials": len(obj.material_slots), "non_manifold_edges": non_manifold}


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for old in list(bpy.data.collections):
        bpy.data.collections.remove(old)
    collection = bpy.data.collections.new(COLLECTION_NAME)
    bpy.context.scene.collection.children.link(collection)
    shared_material = material()
    rigid = make_object("RigidLitter", build_rigid(), collection, shared_material)
    soft = make_object("SoftLitter", build_soft(), collection, shared_material)
    audit = {
        "objects": {rigid.name: audit_object(rigid), soft.name: audit_object(soft)},
        "interfaces": {
            "bottle_profile_ring_gaps": 0,
            "snack_top_seal_body_overlap": 0.050,
            "snack_bottom_seal_body_overlap": 0.050,
            "snack_badge_front_offset": 0.001,
        },
        "runtime_budget": "2 shared meshes, 1 shared material, vertex colors, no textures",
    }
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB", use_selection=True,
                              export_colors=True, export_materials="EXPORT")
    AUDIT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
