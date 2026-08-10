import bpy
import bmesh
import re


REPAIRS = {
    "AccessCore_N_Architecture": (
        ("Y", (225, 226), 21.384),
        ("Y", (227, 224), 21.384),
        ("Y", (233, 234), 23.918),
        ("Y", (235, 232), 23.918),
    ),
    "AccessCore_E_Architecture": (
        ("X", (242, 243), 61.223),
        ("X", (240, 241), 61.223),
        ("X", (250, 251), 64.096),
        ("X", (248, 249), 64.096),
    ),
    "AccessCore_S_Architecture": (
        ("Y", (225, 226), -21.384),
        ("Y", (227, 224), -21.384),
        ("Y", (233, 234), -23.918),
        ("Y", (235, 232), -23.918),
    ),
}


def set_world_axis(obj, vertex_indices, axis, target):
    axis_index = 0 if axis == "X" else 1
    inverse = obj.matrix_world.inverted()
    for vertex_index in vertex_indices:
        vertex = obj.data.vertices[vertex_index]
        world = obj.matrix_world @ vertex.co
        world[axis_index] = target
        vertex.co = inverse @ world


for object_name, repairs in REPAIRS.items():
    obj = bpy.data.objects[object_name]
    for axis, vertex_indices, target in repairs:
        set_world_axis(obj, vertex_indices, axis, target)
    obj.data.update()

removed_bottom_faces = 0
for obj in bpy.data.objects:
    if obj.type != "MESH" or not re.match(r"^BleacherNew(?:Half)?_T2_[NSE]_", obj.name):
        continue
    target_indices = []
    for polygon in obj.data.polygons:
        material = obj.data.materials[polygon.material_index]
        world_normal = (obj.matrix_world.to_3x3() @ polygon.normal).normalized()
        world_center = obj.matrix_world @ polygon.center
        if (
            material
            and material.name == "Bleacher_Step_Concrete"
            and world_normal.z < -0.9999
            and abs(world_center.z - 2.24) < 0.001
            and polygon.area > 8.9
        ):
            target_indices.append(polygon.index)
    if not target_indices:
        continue
    if len(target_indices) != 1:
        raise RuntimeError(f"Unexpected T2 bottom faces on {obj.name}: {target_indices}")
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.faces.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[mesh.faces[target_indices[0]]], context="FACES")
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()
    removed_bottom_faces += 1

bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print("Removed covered T2 bottom faces:", removed_bottom_faces)
print("Repaired access-wall coplanar overlaps and saved", bpy.data.filepath)