from pathlib import Path
from math import cos, pi, sin

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SRC_GLB = ROOT / "assets" / "resources" / "models" / "UserSwimmer.glb"
OUT_GLB = ROOT / "assets" / "resources" / "models" / "UserSwimmerLow.glb"
OUT_BLEND = ROOT / "tools" / "UserSwimmerLow.blend"

TARGET_TRIANGLES = 1000
VOXEL_SIZE = 0.028
SEGMENTS = 10
TEXTURE_SIZE = 256
UV_X_MIN = -0.32
UV_X_MAX = 0.32
UV_Z_MIN = 0.0
UV_Z_MAX = 1.06


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def triangle_count(obj):
    return sum(len(poly.vertices) - 2 for poly in obj.data.polygons)


def make_material(name, color, roughness=0.56):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0
    return material


def clamp(value, min_value=0.0, max_value=1.0):
    return max(min_value, min(max_value, value))


def make_clothes_texture():
    image = bpy.data.images.new("UserSwimmerLowClothes", TEXTURE_SIZE, TEXTURE_SIZE, alpha=True)
    pixels = [0.0] * (TEXTURE_SIZE * TEXTURE_SIZE * 4)

    skin = (0.78, 0.62, 0.52, 1.0)
    suit = (0.05, 0.42, 0.78, 1.0)
    cap = (0.04, 0.12, 0.42, 1.0)
    suit_edge = (0.025, 0.20, 0.38, 1.0)

    for y in range(TEXTURE_SIZE):
        v = (y + 0.5) / TEXTURE_SIZE
        for x in range(TEXTURE_SIZE):
            u = (x + 0.5) / TEXTURE_SIZE
            nx = (u - 0.5) * 2.0
            ax = abs(nx)
            color = skin

            torso_width = 0.38 + clamp((v - 0.54) / 0.30) * 0.22
            if 0.42 <= v <= 0.91 and ax <= torso_width:
                color = suit
            if 0.30 <= v < 0.60 and ax <= 0.58:
                color = suit
            if 0.24 <= v < 0.47 and 0.12 <= ax <= 0.56:
                color = suit
            if 0.34 <= v <= 0.91 and 0.42 <= ax <= 0.98:
                color = suit

            if 0.44 <= v <= 0.56 and ax >= 0.58:
                color = skin

            if (0.902 <= v <= 0.915 and ax <= 0.46) or (0.232 <= v <= 0.246 and 0.12 <= ax <= 0.56):
                color = suit_edge
            if 0.330 <= v <= 0.345 and 0.42 <= ax <= 0.98:
                color = suit_edge

            # Keep the cap as a shallow top patch. X/Z projection cannot know
            # front/back, so use a high cutoff and full head width instead of a band.
            if 0.965 <= v <= 1.0 and ax <= 0.78:
                color = cap

            index = (y * TEXTURE_SIZE + x) * 4
            pixels[index:index + 4] = color

    image.pixels = pixels
    image.pack()
    return image


def make_textured_material(name, image, roughness=0.56):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    texture = nodes.new(type="ShaderNodeTexImage")
    texture.image = image
    texture.extension = "CLIP"
    if bsdf:
        material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0
    return material


def assign_projected_uvs(obj):
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    uv_layer = obj.data.uv_layers.new(name="ClothesUV")
    for poly in obj.data.polygons:
        for loop_index in poly.loop_indices:
            vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index]
            co = vertex.co
            u = clamp((co.x - UV_X_MIN) / (UV_X_MAX - UV_X_MIN))
            v = clamp((co.z - UV_Z_MIN) / (UV_Z_MAX - UV_Z_MIN))
            uv_layer.data[loop_index].uv = (u, v)


def assign_body_materials(obj, white):
    obj.data.materials.clear()
    obj.data.materials.append(white)

    for poly in obj.data.polygons:
        poly.material_index = 0


def triangle_fan_mesh(name, verts, faces, weights, armature, material):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = armature
    obj.matrix_parent_inverse.identity()
    obj.data.materials.append(material)
    groups = {bone.name: obj.vertex_groups.new(name=bone.name) for bone in armature.data.bones}
    for index, weight_map in enumerate(weights):
        for bone_name, weight in weight_map.items():
            groups[bone_name].add([index], weight, "ADD")
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = armature
    return obj


def ring(center, radius_x, radius_y, z_offset=0):
    center = Vector(center) + Vector((0, 0, z_offset))
    return [
        center + Vector((cos(pi * 2 * i / SEGMENTS) * radius_x, sin(pi * 2 * i / SEGMENTS) * radius_y, 0))
        for i in range(SEGMENTS)
    ]


def add_rings(verts, weights, rings, ring_weights):
    start = len(verts)
    for points, weight_map in zip(rings, ring_weights):
        verts.extend(points)
        weights.extend([weight_map] * len(points))
    return [list(range(start + i * SEGMENTS, start + (i + 1) * SEGMENTS)) for i in range(len(rings))]


def connect_ring_faces(faces, ring_ids):
    for ring_index in range(len(ring_ids) - 1):
        a = ring_ids[ring_index]
        b = ring_ids[ring_index + 1]
        for i in range(SEGMENTS):
            j = (i + 1) % SEGMENTS
            faces.append((a[i], a[j], b[j], b[i]))


def add_caps(verts, faces, weights, ring_ids, cap_weights):
    bottom_center = len(verts)
    verts.append(sum((verts[i] for i in ring_ids[0]), Vector()) / SEGMENTS)
    weights.append(cap_weights[0])
    top_center = len(verts)
    verts.append(sum((verts[i] for i in ring_ids[-1]), Vector()) / SEGMENTS)
    weights.append(cap_weights[-1])
    for i in range(SEGMENTS):
        j = (i + 1) % SEGMENTS
        faces.append((bottom_center, ring_ids[0][j], ring_ids[0][i]))
        faces.append((top_center, ring_ids[-1][i], ring_ids[-1][j]))


def cylinder_between(verts, faces, weights, start, end, r0, r1, weight_map):
    start = Vector(start)
    end = Vector(end)
    axis = end - start
    if axis.length <= 0.0001:
        return
    axis.normalize()
    helper = Vector((0, 0, 1))
    if abs(axis.dot(helper)) > 0.92:
        helper = Vector((0, 1, 0))
    x_axis = axis.cross(helper).normalized()
    y_axis = axis.cross(x_axis).normalized()
    rings = []
    for center, radius in ((start, r0), (end, r1)):
        points = []
        for i in range(SEGMENTS):
            angle = pi * 2 * i / SEGMENTS
            points.append(center + x_axis * cos(angle) * radius + y_axis * sin(angle) * radius)
        rings.append(points)
    ids = add_rings(verts, weights, rings, [weight_map, weight_map])
    connect_ring_faces(faces, ids)
    add_caps(verts, faces, weights, ids, [weight_map, weight_map])


def build_shirt(armature, bones, material):
    hips = (bones["Hips"][1] + bones["Spine"][0]) * 0.5
    waist = (bones["Spine"][0] + bones["Spine1"][0]) * 0.5
    chest = (bones["LeftShoulder"][0] + bones["RightShoulder"][0] + bones["Spine2"][0]) / 3
    collar = (bones["Neck"][0] + bones["LeftShoulder"][0] + bones["RightShoulder"][0]) / 3
    verts, faces, weights = [], [], []
    ring_ids = add_rings(
        verts,
        weights,
        [
            ring(hips + Vector((0, 0, 0.01)), 0.24, 0.12),
            ring(waist + Vector((0, 0, 0.04)), 0.24, 0.115),
            ring(chest + Vector((0, 0, -0.035)), 0.225, 0.135),
            ring(collar + Vector((0, -0.003, -0.012)), 0.13, 0.082),
        ],
        [
            {"Hips": 0.6, "Spine": 0.4},
            {"Spine": 0.4, "Spine1": 0.45, "Spine2": 0.15},
            {"Spine2": 0.8, "Spine1": 0.2},
            {"Spine2": 0.75, "Neck": 0.25},
        ],
    )
    connect_ring_faces(faces, ring_ids)
    add_caps(verts, faces, weights, ring_ids, [{"Hips": 0.6, "Spine": 0.4}, {"Spine2": 0.75, "Neck": 0.25}])
    for side in ("Left", "Right"):
        shoulder = f"{side}Shoulder"
        arm = f"{side}Arm"
        cylinder_between(verts, faces, weights, bones[shoulder][0], bones[shoulder][1], 0.06, 0.055, {shoulder: 1})
        sleeve_end = bones[arm][0].lerp(bones[arm][1], 0.28)
        cylinder_between(verts, faces, weights, bones[arm][0], sleeve_end, 0.058, 0.052, {arm: 1})
    return triangle_fan_mesh("Suit", verts, faces, weights, armature, material)


def build_shorts(armature, bones, material):
    hips = (bones["LeftUpLeg"][0] + bones["RightUpLeg"][0] + bones["Hips"][0]) / 3
    waist = (bones["Spine"][0] + bones["Hips"][1]) * 0.5
    verts, faces, weights = [], [], []
    ring_ids = add_rings(
        verts,
        weights,
        [
            ring(hips + Vector((0, 0, -0.005)), 0.28, 0.13),
            ring(hips + Vector((0, 0, 0.052)), 0.26, 0.125),
            ring(waist + Vector((0, 0, -0.006)), 0.23, 0.115),
        ],
        [
            {"Hips": 0.9, "Spine": 0.1},
            {"Hips": 0.75, "Spine": 0.25},
            {"Hips": 0.45, "Spine": 0.55},
        ],
    )
    connect_ring_faces(faces, ring_ids)
    add_caps(verts, faces, weights, ring_ids, [{"Hips": 0.9, "Spine": 0.1}, {"Hips": 0.45, "Spine": 0.55}])
    for side in ("Left", "Right"):
        up_leg = f"{side}UpLeg"
        end = bones[up_leg][0].lerp(bones[up_leg][1], 0.52)
        cylinder_between(verts, faces, weights, bones[up_leg][0], end, 0.09, 0.08, {up_leg: 1})
    return triangle_fan_mesh("Shorts", verts, faces, weights, armature, material)


def normalize_weights(obj):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    except RuntimeError:
        pass
    obj.select_set(False)


def main():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(SRC_GLB))

    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    source = max((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), key=triangle_count)
    source.name = "SourceHigh"

    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.context.view_layer.objects.active = source
    bpy.ops.object.duplicate()
    proxy = bpy.context.object
    proxy.name = "Skin"
    proxy.data = proxy.data.copy()

    for modifier in list(proxy.modifiers):
        proxy.modifiers.remove(modifier)

    remesh = proxy.modifiers.new("ProxyVoxelRemesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = VOXEL_SIZE
    remesh.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=remesh.name)

    decimate = proxy.modifiers.new("ProxyDecimate", "DECIMATE")
    decimate.ratio = min(1.0, TARGET_TRIANGLES / max(1, triangle_count(proxy)))
    bpy.ops.object.modifier_apply(modifier=decimate.name)

    transfer = proxy.modifiers.new("ProxyWeights", "DATA_TRANSFER")
    transfer.object = source
    transfer.use_vert_data = True
    transfer.data_types_verts = {"VGROUP_WEIGHTS"}
    transfer.vert_mapping = "POLYINTERP_NEAREST"
    bpy.ops.object.modifier_apply(modifier=transfer.name)
    normalize_weights(proxy)

    arm_mod = proxy.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = armature
    proxy.parent = armature
    proxy.matrix_parent_inverse.identity()

    texture = make_clothes_texture()
    material = make_textured_material("ProxyClothesTexture", texture)
    assign_projected_uvs(proxy)
    assign_body_materials(proxy, material)
    for poly in proxy.data.polygons:
        poly.use_smooth = True

    for obj in list(bpy.context.scene.objects):
        if obj is proxy or obj is armature:
            continue
        bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.export_scene.gltf(filepath=str(OUT_GLB), export_format="GLB", export_materials="EXPORT", export_apply=False)
    print("EXPORTED_REMESH", OUT_GLB)
    total = triangle_count(proxy)
    print("TOTAL_TRIS", total)
    print("VERTS", len(proxy.data.vertices))
    print("BONES", len(armature.data.bones))
    print("VERTEX_GROUPS", len(proxy.vertex_groups))


if __name__ == "__main__":
    main()
