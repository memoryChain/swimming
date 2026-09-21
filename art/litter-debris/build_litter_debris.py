"""重建垃圾漂流玩法的三种瓶子与泡沫餐盒低模参考资产。"""

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

    def profile_rings_x(self, rings, segments=10):
        """用共享截面生成连续瓶身；每个截面可独立改变椭圆半径和中心。"""
        offset = len(self.vertices)
        for x, radius_y, radius_z, center_y, center_z, _color in rings:
            self.vertices.extend([
                (x, center_y + math.cos(side / segments * math.tau) * radius_y,
                 center_z + math.sin(side / segments * math.tau) * radius_z)
                for side in range(segments)
            ])
        self.faces.append(tuple(offset + index for index in reversed(range(segments))))
        self.colors.append(rings[0][5])
        for ring_index in range(len(rings) - 1):
            ring_start = offset + ring_index * segments
            next_start = ring_start + segments
            for side in range(segments):
                nxt = (side + 1) % segments
                self.faces.append((ring_start + side, ring_start + nxt, next_start + nxt, next_start + side))
                self.colors.append(rings[ring_index][5])
        last = offset + (len(rings) - 1) * segments
        self.faces.append(tuple(last + index for index in range(segments)))
        self.colors.append(rings[-1][5])


COLA_DARK = (0.24, 0.09, 0.035, 1)
COLA_LIGHT = (0.48, 0.22, 0.075, 1)
COLA_LABEL = (0.88, 0.055, 0.035, 1)
COLA_LABEL_LIGHT = (1, 0.82, 0.42, 1)
COLA_CAP = (0.72, 0.035, 0.025, 1)
WATER_CLEAR = (0.54, 0.83, 0.9, 1)
WATER_SHADOW = (0.28, 0.62, 0.74, 1)
WATER_LABEL = (0.08, 0.43, 0.78, 1)
WATER_LABEL_LIGHT = (0.88, 0.96, 0.94, 1)
SPORT_TEAL = (0.05, 0.48, 0.49, 1)
SPORT_DARK = (0.025, 0.19, 0.25, 1)
SPORT_ORANGE = (1, 0.38, 0.045, 1)
SPORT_LIGHT = (0.9, 0.9, 0.68, 1)
FOAM_BASE = (0.68, 0.65, 0.54, 1)
FOAM_LIGHT = (0.93, 0.9, 0.76, 1)
FOAM_RIM = (0.82, 0.79, 0.67, 1)
FOAM_SHADOW = (0.49, 0.47, 0.4, 1)
FOOD_STAIN = (0.68, 0.31, 0.055, 1)


def build_classic_cola():
    b = Builder()
    b.profile_rings_x([
        (-0.39, 0.064, 0.064, 0.035, 0, COLA_CAP),
        (-0.345, 0.064, 0.064, 0.035, 0, COLA_CAP),
        (-0.325, 0.054, 0.054, 0.035, 0, COLA_DARK),
        (-0.265, 0.064, 0.064, 0.035, 0, COLA_LIGHT),
        (-0.195, 0.108, 0.108, 0.035, 0, COLA_LIGHT),
        (-0.125, 0.128, 0.128, 0.035, 0, COLA_DARK),
        (-0.09, 0.13, 0.13, 0.035, 0, COLA_LABEL),
        (0.12, 0.13, 0.13, 0.035, 0, COLA_LABEL),
        (0.155, 0.13, 0.13, 0.035, 0, COLA_LABEL_LIGHT),
        (0.275, 0.126, 0.126, 0.035, 0, COLA_DARK),
        (0.355, 0.112, 0.112, 0.035, 0, COLA_DARK),
        (0.39, 0.092, 0.092, 0.035, 0, COLA_DARK),
    ])
    return b


def build_crushed_water():
    b = Builder()
    b.profile_rings_x([
        (-0.37, 0.052, 0.048, 0.015, 0.002, WATER_LABEL),
        (-0.325, 0.052, 0.048, 0.015, 0.002, WATER_LABEL),
        (-0.30, 0.045, 0.042, 0.014, 0.002, WATER_SHADOW),
        (-0.245, 0.074, 0.064, 0.012, 0.008, WATER_CLEAR),
        (-0.17, 0.112, 0.078, 0.004, 0.014, WATER_CLEAR),
        (-0.08, 0.095, 0.062, -0.012, 0.02, WATER_SHADOW),
        (-0.02, 0.116, 0.074, -0.018, 0.012, WATER_LABEL),
        (0.12, 0.102, 0.065, -0.006, -0.008, WATER_LABEL_LIGHT),
        (0.21, 0.116, 0.076, 0.012, -0.015, WATER_CLEAR),
        (0.29, 0.09, 0.062, 0.018, -0.008, WATER_SHADOW),
        (0.37, 0.074, 0.055, 0.012, 0, WATER_CLEAR),
    ], segments=8)
    return b


def build_sport_drink():
    b = Builder()
    b.profile_rings_x([
        (-0.33, 0.082, 0.082, 0.025, 0, SPORT_ORANGE),
        (-0.275, 0.082, 0.082, 0.025, 0, SPORT_ORANGE),
        (-0.255, 0.066, 0.066, 0.025, 0, SPORT_DARK),
        (-0.205, 0.102, 0.102, 0.025, 0, SPORT_TEAL),
        (-0.145, 0.144, 0.13, 0.025, 0, SPORT_TEAL),
        (-0.09, 0.15, 0.135, 0.025, 0, SPORT_DARK),
        (0.08, 0.15, 0.135, 0.025, 0, SPORT_LIGHT),
        (0.14, 0.15, 0.135, 0.025, 0, SPORT_ORANGE),
        (0.26, 0.142, 0.128, 0.025, 0, SPORT_TEAL),
        (0.33, 0.12, 0.108, 0.025, 0, SPORT_DARK),
    ])
    return b


def build_meal_tray():
    b = Builder()
    outer = [(-0.38, -0.205), (-0.32, -0.255), (0.31, -0.255), (0.39, -0.185),
             (0.39, 0.185), (0.31, 0.255), (-0.32, 0.255), (-0.39, 0.19)]
    lid = [(-0.32, -0.16), (-0.27, -0.205), (0.25, -0.205), (0.32, -0.15),
           (0.32, 0.145), (0.25, 0.2), (-0.27, 0.2), (-0.32, 0.15)]
    b.prism(outer, -0.07, 0.005, FOAM_BASE)
    b.prism(lid, 0.006, 0.075, FOAM_LIGHT)
    b.box((-0.34, -0.23, 0.012), (0.34, -0.19, 0.09), FOAM_RIM)
    b.box((-0.34, 0.19, 0.012), (0.34, 0.23, 0.09), FOAM_RIM)
    b.box((-0.375, -0.17, 0.012), (-0.325, 0.17, 0.09), FOAM_RIM)
    b.box((0.325, -0.17, 0.012), (0.375, 0.17, 0.09), FOAM_RIM)
    b.box((-0.31, 0.225, -0.045), (0.31, 0.262, 0.035), FOAM_SHADOW)
    b.prism([(-0.19, -0.08), (0.11, -0.1), (0.2, -0.015),
             (0.13, 0.08), (-0.16, 0.07)], 0.076, 0.086, FOOD_STAIN)
    b.box((-0.025, -0.17, 0.076), (0.015, 0.14, 0.087), FOAM_RIM)
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


def make_object(name, builder, collection, mat, runtime_role):
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
    obj["runtime_role"] = runtime_role
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
    if not 40 <= triangles <= 450:
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
    objects = [
        make_object("ClassicColaBottle", build_classic_cola(), collection, shared_material, "rigid_bounce_0"),
        make_object("CrushedWaterBottle", build_crushed_water(), collection, shared_material, "rigid_bounce_1"),
        make_object("SportDrinkBottle", build_sport_drink(), collection, shared_material, "rigid_bounce_2"),
        make_object("FoamMealTray", build_meal_tray(), collection, shared_material, "soft_drag"),
    ]
    audit = {
        "objects": {obj.name: audit_object(obj) for obj in objects},
        "interfaces": {
            "connected_bottle_profile_ring_gaps": 0,
            "meal_tray_closed_shell": True,
            "shared_material_count": 1,
        },
        "runtime_budget": "4 shared meshes, 1 shared material, vertex colors, no textures",
    }
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB", use_selection=True,
                              export_colors=True, export_materials="EXPORT")
    AUDIT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
