"""Build the sea-turtle bus authoring scene and compact runtime vertex meshes.

Run through scripts/run-blender.py. Blender is the editable source; the generated
TypeScript meshes avoid a separate Cocos import step for this tiny event prop.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "art" / "turtle-bus"
OUTPUT = ROOT / "assets" / "scripts" / "core" / "TurtleBusGeometry.ts"

PALETTE = {
    "shell": (0.23, 0.43, 0.32, 1),
    "shell_edge": (0.15, 0.31, 0.25, 1),
    "shell_light": (0.37, 0.57, 0.40, 1),
    "scute": (0.28, 0.49, 0.34, 1),
    "skin": (0.43, 0.67, 0.48, 1),
    "skin_shadow": (0.31, 0.53, 0.38, 1),
    "eye": (0.035, 0.10, 0.085, 1),
    "eye_glint": (0.91, 0.96, 0.80, 1),
    "ring": (0.96, 0.43, 0.13, 1),
    "ring_light": (1.0, 0.80, 0.42, 1),
    "rope": (0.79, 0.72, 0.47, 1),
    "rope_shadow": (0.55, 0.50, 0.32, 1),
}


def material(name: str):
    item = bpy.data.materials.new(name)
    item.diffuse_color = PALETTE[name]
    return item


MATERIALS = {}


def assign(obj, name: str, group: str):
    obj.name = name
    obj.data.materials.append(MATERIALS[group])
    obj["runtime_group"] = group
    return obj


def ellipsoid(name, location, scale, color, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return assign(obj, name, color)


def mesh_part(name, vertices, faces, face_colors, group):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj["runtime_group"] = group
    colors = list(dict.fromkeys(face_colors))
    for color in colors:
        mesh.materials.append(MATERIALS[color])
    for polygon, color in zip(mesh.polygons, face_colors):
        polygon.material_index = colors.index(color)
    return obj


def shell_height(x, y):
    radius = math.sqrt(((x + .10) / 1.65) ** 2 + (y / 1.16) ** 2)
    return .23 + .68 * math.sqrt(max(0, 1 - radius * radius))


def make_shell():
    # One continuous domed carapace. The perimeter folds down into the rim.
    segments = 24
    radii = (.0, .24, .48, .70, .86, .96, 1.0, 1.04)
    vertices = [(-.10, 0, shell_height(-.10, 0))]
    for radius in radii[1:]:
        for sector in range(segments):
            angle = sector * math.tau / segments
            x = -.10 + 1.65 * radius * math.cos(angle)
            y = 1.16 * radius * math.sin(angle)
            z = shell_height(x, y) if radius <= 1 else .15
            vertices.append((x, y, z))
    faces, colors = [], []
    for sector in range(segments):
        faces.append((0, 1 + sector, 1 + (sector + 1) % segments))
        colors.append("shell_light" if sector % 6 < 3 else "scute")
    for ring in range(len(radii) - 2):
        for sector in range(segments):
            a = 1 + ring * segments + sector
            b = 1 + ring * segments + (sector + 1) % segments
            c = a + segments
            d = b + segments
            faces.append((a, c, d, b))
            colors.append("shell_edge" if ring >= 4 else
                          ("shell_light" if ring == 1 and sector % 6 < 3 else "shell"))
    mesh_part("Carapace continuous dome and rim", vertices, faces, colors, "shell")


def make_scute(name, polygon, color):
    # Hexagonal seams conform to the same dome; no floating shell plate primitives.
    if sum(polygon[i][0] * polygon[(i+1) % len(polygon)][1]
           - polygon[(i+1) % len(polygon)][0] * polygon[i][1]
           for i in range(len(polygon))) < 0:
        polygon = list(reversed(polygon))
    outer = [(x, y, shell_height(x, y) + .008) for x, y in polygon]
    cx = sum(p[0] for p in polygon) / len(polygon)
    cy = sum(p[1] for p in polygon) / len(polygon)
    inner = [(cx + (x - cx) * .88, cy + (y - cy) * .88,
              shell_height(cx + (x - cx) * .88, cy + (y - cy) * .88) + .012)
             for x, y in polygon]
    vertices = outer + inner + [(cx, cy, shell_height(cx, cy) + .014)]
    count = len(polygon)
    faces, colors = [], []
    for index in range(count):
        faces.append((index, (index + 1) % count, count + (index + 1) % count, count + index))
        colors.append("shell_edge")
        faces.append((count + index, count + (index + 1) % count, count * 2))
        colors.append(color)
    mesh_part(name, vertices, faces, colors, "shell")


def make_head():
    # Cross-section rings form one neck, broad cheek/skull and tapered beak.
    profiles = [
        (1.32, .32, .13, .20), (1.53, .38, .18, .25),
        (1.78, .48, .22, .33), (2.05, .50, .25, .34),
        (2.30, .40, .23, .27), (2.49, .24, .16, .18),
        (2.57, .05, .13, .08),
    ]
    sides = 12
    vertices = []
    for x, width, center_z, height in profiles:
        for index in range(sides):
            angle = index * math.tau / sides
            vertices.append((x, width * math.cos(angle), center_z + height * math.sin(angle)))
    faces, colors = [], []
    faces.append(tuple(reversed(range(sides)))); colors.append("skin_shadow")
    for profile in range(len(profiles) - 1):
        for index in range(sides):
            a = profile * sides + index
            b = profile * sides + (index + 1) % sides
            faces.append((a, b, b + sides, a + sides))
            colors.append("skin_shadow" if index < 3 or index > 10 else "skin")
    faces.append(tuple((len(profiles) - 1) * sides + i for i in range(sides)))
    colors.append("skin")
    mesh_part("Continuous neck skull and beak", vertices, faces, colors, "skin")


def make_flipper(name, side, front):
    if front:
        path = [(.85, .84, .12, .43), (.88, 1.18, .10, .63),
                (.72, 1.58, .05, .80), (.39, 2.08, .01, .68),
                (-.03, 2.53, -.025, .42), (-.38, 2.78, -.04, .10)]
    else:
        path = [(-1.26, .73, .07, .35), (-1.52, 1.05, .035, .47),
                (-1.81, 1.40, 0, .43), (-2.07, 1.55, -.025, .13)]
    vertices = []
    for index, (x, y, z, width) in enumerate(path):
        before = path[max(0, index - 1)]
        after = path[min(len(path) - 1, index + 1)]
        dx, dy = after[0] - before[0], after[1] - before[1]
        tangent = math.hypot(dx, dy)
        nx, ny = -dy / tangent, dx / tangent
        # Shoulder grows into a broad swept paddle, with a raised midrib.
        for fraction, height in ((-.5, -.045), (0, .06), (.5, -.045)):
            vertices.append((x + nx * width * fraction,
                             side * (y + ny * width * fraction), z + height))
        for fraction in (-.5, 0, .5):
            vertices.append((x + nx * width * fraction,
                             side * (y + ny * width * fraction), z - .08))
    faces, colors = [], []
    for index in range(len(path) - 1):
        a, b = index * 6, (index + 1) * 6
        for segment in range(2):
            faces.append((a + segment, b + segment, b + segment + 1, a + segment + 1))
            colors.append("skin" if segment == 0 else "skin_shadow")
            faces.append((a + segment + 3, a + segment + 4, b + segment + 4, b + segment + 3))
            colors.append("skin_shadow")
        faces.extend(((a, a + 3, b + 3, b), (a + 2, b + 2, b + 5, a + 5)))
        colors.extend(("skin_shadow", "skin_shadow"))
    faces.extend(((0, 1, 2, 5, 4, 3),
                  tuple((len(path) - 1) * 6 + k for k in (0, 3, 4, 5, 2, 1))))
    colors.extend(("skin_shadow", "skin_shadow"))
    if side < 0:
        faces = [tuple(reversed(face)) for face in faces]
    mesh_part(name, vertices, faces, colors, "skin")


def rod(name, a, b, radius, color, vertices=6):
    mid = (Vector(a) + Vector(b)) * 0.5
    direction = Vector(b) - Vector(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                        depth=direction.length, location=mid)
    obj = bpy.context.object
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return assign(obj, name, color)


def add_turtle():
    ellipsoid("Plastron under continuous shell", (-.08, 0, .08),
              (1.55, 1.07, .25), "skin_shadow", 16, 6)
    make_shell()
    for index, (x, length) in enumerate(((.77, .55), (.18, .55), (-.42, .55), (-1.01, .37))):
        make_scute(f"Vertebral scute {index + 1}",
                   [(x + length*.52, 0), (x + length*.27, .34),
                    (x - length*.30, .34), (x - length*.52, 0),
                    (x - length*.30, -.34), (x + length*.27, -.34)],
                   "shell_light" if index % 2 else "scute")
    for side in (-1, 1):
        for index, x in enumerate((.67, -.02, -.70)):
            make_scute(f"Costal scute {side} {index}",
                       [(x+.29, side*.38), (x+.38, side*.62),
                        (x+.18, side*.86), (x-.19, side*.88),
                        (x-.35, side*.61), (x-.24, side*.39)],
                       "scute" if index % 2 else "shell_light")
    make_head()
    for side in (-1, 1):
        ellipsoid("Eye socket", (2.04, side*.428, .405), (.16, .079, .13),
                  "skin_shadow", 10, 5)
        ellipsoid("Eye", (2.065, side * .487, .425), (.088, .040, .082), "eye", 10, 5)
        ellipsoid("Eye glint", (2.090, side * .520, .459), (.024, .014, .023), "eye_glint", 8, 4)
        make_flipper("Front flipper", side, True)
        make_flipper("Rear flipper", side, False)
    ellipsoid("Tail", (-1.82, 0, .02), (.46, .17, .09), "skin_shadow", 8, 4)
    # Two clearly visible attachment points on the shell rim.
    for side in (-1, 1):
        ellipsoid("Harness eye", (-1.47, side*.75, .22), (.16, .16, .12), "rope_shadow", 8, 4)


def add_ring_and_rope(index, x, lateral):
    # Torus is horizontal in Blender XY, centered on the waterline.
    bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=6,
                                    location=(x, lateral, .02),
                                    major_radius=.58, minor_radius=.12)
    assign(bpy.context.object, f"Tow ring {index}", "ring")
    for side in (-1, 1):
        theta = math.pi * (.20 if side < 0 else .80)
        px = x + .58 * math.cos(theta)
        py = lateral + .58 * math.sin(theta)
        ellipsoid(f"Grip pad {index} {side}", (px, py, .13),
                  (.12, .15, .035), "ring_light", 8, 4)
    anchor_y = -.75 if lateral < 0 else .75
    rod(f"Tow rope {index}", (-1.47, anchor_y, .22),
        (x + .57, lateral, .04), .036, "rope")


def export_runtime_meshes():
    groups = {"body": {"vertices": [], "lookup": {}, "indices": []},
              "frontFins": {"vertices": [], "lookup": {}, "indices": []},
              "rearFins": {"vertices": [], "lookup": {}, "indices": []},
              "rings": {"vertices": [], "lookup": {}, "indices": []},
              "ropes": {"vertices": [], "lookup": {}, "indices": []}}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "runtime_group" not in obj:
            continue
        color_name = obj["runtime_group"]
        group = ("frontFins" if obj.name.startswith("Front flipper") else
                 "rearFins" if obj.name.startswith("Rear flipper") else
                 "rings" if color_name.startswith("ring") else
                 "ropes" if color_name.startswith("rope") else "body")
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        matrix = obj.matrix_world
        target = groups[group]
        for tri in mesh.loop_triangles:
            face_color = mesh.materials[mesh.polygons[tri.polygon_index].material_index].name
            for vertex_index in tri.vertices[::-1]:  # Y/Z swap reverses winding.
                vec = matrix @ mesh.vertices[vertex_index].co
                vertex = (round(vec.x, 3), round(vec.z, 3),
                          round(vec.y, 3), face_color)
                if vertex not in target["lookup"]:
                    target["lookup"][vertex] = len(target["vertices"])
                    target["vertices"].append(vertex)
                target["indices"].append(target["lookup"][vertex])
        evaluated.to_mesh_clear()
    result = {}
    for name, source in groups.items():
        positions, colors = [], []
        for x, y, z, color_name in source["vertices"]:
            positions.extend((x, y, z))
            colors.extend(PALETTE[color_name])
        result[name] = {"positions": positions, "colors": colors,
                        "indices": source["indices"]}
    triangle_count = sum(len(mesh["indices"]) // 3 for mesh in result.values())
    if triangle_count > 6000:
        raise RuntimeError(f"Turtle bus triangle budget exceeded: {triangle_count}")
    OUTPUT.write_text("// Generated by art/turtle-bus/build_turtle_bus.py; do not edit by hand.\n"
                      "export const TURTLE_BUS_GEOMETRY = "
                      + json.dumps(result, separators=(",", ":")) + ";\n", encoding="utf-8")
    (ART / "model-audit.json").write_text(json.dumps({
        "triangles": triangle_count,
        "drawCalls": len(result),
        "groups": {key: len(value["indices"]) // 3 for key, value in result.items()},
        "ringCenters": [[-3.8, -3.6], [-4.6, -1.2], [-4.6, 1.2], [-3.8, 3.6]],
    }, indent=2) + "\n", encoding="utf-8")


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    MATERIALS.update({name: material(name) for name in PALETTE})
    add_turtle()
    for i, (x, lateral) in enumerate(zip((-3.8, -4.6, -4.6, -3.8),
                                         (-3.6, -1.2, 1.2, 3.6))):
        add_ring_and_rope(i, x, lateral)
    bpy.ops.wm.save_as_mainfile(filepath=str(ART / "TurtleBus.blend"))
    export_runtime_meshes()
    print("TURTLE_BUS_MODEL_OK")


if __name__ == "__main__":
    main()
