import math
from pathlib import Path

import bpy
import mathutils


ROOT = Path(__file__).resolve().parents[1]
OUT_GLB = ROOT / "assets" / "resources" / "pool" / "LowPolyPool.glb"
OUT_BLEND = ROOT / "tools" / "LowPolyPool.blend"
OUT_PREVIEW = ROOT / "tools" / "lowpoly_pool_preview.png"
OUT_FLOOR_TEXTURE = ROOT / "assets" / "resources" / "pool" / "LowPolyPoolFloor.png"

LANE_COUNT = 8
LANE_WIDTH = 2.05
POOL_WIDTH = LANE_COUNT * LANE_WIDTH
POOL_LENGTH = 104.0
RACE_LENGTH = 100.0


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def mat(name, color, roughness=0.7, metallic=0.0, alpha=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        material.blend_method = "BLEND"
        material.use_screen_refraction = True
        material.show_transparent_back = True
    return material


def textured_mat(name, image_path, color=(1.0, 1.0, 1.0), roughness=0.8):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    tex = material.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(image_path))
    material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return material


def create_floor_texture():
    OUT_FLOOR_TEXTURE.parent.mkdir(parents=True, exist_ok=True)
    width = 1024
    height = 256
    image = bpy.data.images.new("LowPolyPoolFloorTexture", width, height, alpha=True)
    pixels = [0.58, 0.86, 0.98, 1.0] * width * height

    def put_pixel(x, y, color):
        if x < 0 or x >= width or y < 0 or y >= height:
            return
        i = (y * width + x) * 4
        pixels[i:i + 4] = color

    lane_color = [0.13, 0.45, 0.78, 1.0]
    border_color = [0.22, 0.62, 0.88, 1.0]
    for lane in range(LANE_COUNT):
        center = int((lane + 0.5) / LANE_COUNT * height)
        for yy in range(center - 1, center + 2):
            for x in range(0, width):
                put_pixel(x, yy, lane_color)
    for boundary in range(LANE_COUNT + 1):
        y = int(boundary / LANE_COUNT * height)
        for yy in range(y - 1, y + 1):
            for x in range(0, width):
                put_pixel(x, yy, border_color)

    image.pixels = pixels
    image.filepath_raw = str(OUT_FLOOR_TEXTURE)
    image.file_format = "PNG"
    image.save()


def blender_pos(game_location):
    return (game_location[0], game_location[2], game_location[1])


def blender_scale(game_scale):
    return (game_scale[0], game_scale[2], game_scale[1])


def cube(name, location, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=blender_pos(location))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = blender_scale(scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def add_lowpoly_cylinder(name, location, radius, depth, material, vertices=8, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=blender_pos(location),
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def optimize_static_meshes():
    material_groups = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or obj.name == "flat_transparent_water_plane":
            continue
        if not obj.data.materials:
            continue
        material_name = obj.data.materials[0].name
        material_groups.setdefault(material_name, []).append(obj)

    bpy.ops.object.select_all(action="DESELECT")
    for material_name, objects in material_groups.items():
        if len(objects) < 2:
            objects[0].name = f"merged_{material_name}"
            continue

        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        bpy.context.object.name = f"merged_{material_name}"


def lane_center_z(index):
    return -POOL_WIDTH / 2 + LANE_WIDTH * (index + 0.5)


def build_pool():
    create_floor_texture()
    water = mat("water_clear_blue", (0.08, 0.68, 1.0), roughness=0.18, alpha=0.24)
    floor = textured_mat("pool_floor_light_blue_texture", OUT_FLOOR_TEXTURE, roughness=0.82)
    wall = mat("pool_wall_white_blue", (0.82, 0.94, 0.98), roughness=0.78)
    deck = mat("deck_bright_blue", (0.12, 0.42, 0.78), roughness=0.84)
    deck_dark = mat("deck_dark_blue", (0.03, 0.14, 0.34), roughness=0.86)
    banner = mat("simple_pool_banner_blue", (0.05, 0.38, 0.92), roughness=0.72)
    white = mat("bold_white", (0.96, 0.98, 1.0), roughness=0.62)
    red = mat("lane_rope_red", (0.95, 0.08, 0.1), roughness=0.55)
    blue = mat("lane_rope_blue", (0.05, 0.28, 0.95), roughness=0.55)
    block_top = mat("block_top_blue", (0.08, 0.36, 0.78), roughness=0.58)
    block_face = mat("block_face_white", (0.94, 0.96, 0.97), roughness=0.75)
    stand = mat("simple_light_gray_stands", (0.68, 0.71, 0.72), roughness=0.9)

    pool_center_x = RACE_LENGTH / 2
    deck_width = POOL_WIDTH + 64.0
    deck_length = POOL_LENGTH + 46.0

    cube("single_piece_blue_deck_slab", (pool_center_x, -0.42, 0), (deck_length, 0.28, deck_width), deck)
    cube("pool_floor_single_lowpoly", (pool_center_x, -0.18, 0), (POOL_LENGTH, 0.12, POOL_WIDTH), floor)
    cube("left_pool_wall_chunk", (pool_center_x, 0.22, -POOL_WIDTH / 2 - 0.32), (POOL_LENGTH + 0.8, 0.8, 0.64), wall)
    cube("right_pool_wall_chunk", (pool_center_x, 0.22, POOL_WIDTH / 2 + 0.32), (POOL_LENGTH + 0.8, 0.8, 0.64), wall)
    cube("start_pool_wall_chunk", (-2.15, 0.22, 0), (0.72, 0.8, POOL_WIDTH + 1.28), wall)
    cube("finish_pool_wall_chunk", (RACE_LENGTH + 2.15, 0.22, 0), (0.72, 0.8, POOL_WIDTH + 1.28), wall)
    cube("near_white_pool_trim", (pool_center_x, 0.48, -POOL_WIDTH / 2 - 0.72), (POOL_LENGTH + 1.2, 0.16, 0.28), white)
    cube("far_white_pool_trim", (pool_center_x, 0.48, POOL_WIDTH / 2 + 0.72), (POOL_LENGTH + 1.2, 0.16, 0.28), white)
    cube("start_white_pool_trim", (-1.9, 0.5, 0), (0.36, 0.18, POOL_WIDTH + 1.56), white)
    cube("finish_white_pool_trim", (RACE_LENGTH + 1.9, 0.5, 0), (0.36, 0.18, POOL_WIDTH + 1.56), white)

    side_stand_length = POOL_LENGTH + 34.0
    end_stand_width = POOL_WIDTH + 60.0

    cube("left_dark_lower_arena_wall", (pool_center_x, 1.0, -POOL_WIDTH / 2 - 7.2), (side_stand_length, 1.55, 0.9), deck_dark)
    cube("right_dark_lower_arena_wall", (pool_center_x, 1.0, POOL_WIDTH / 2 + 7.2), (side_stand_length, 1.55, 0.9), deck_dark)
    cube("left_blue_banner_band", (pool_center_x, 1.95, -POOL_WIDTH / 2 - 7.75), (side_stand_length, 0.44, 0.2), banner)
    cube("right_blue_banner_band", (pool_center_x, 1.95, POOL_WIDTH / 2 + 7.75), (side_stand_length, 0.44, 0.2), banner)
    for side, label in ((-1, "left"), (1, "right")):
        cube(f"{label}_audience_lower_tier", (pool_center_x, 2.35, side * (POOL_WIDTH / 2 + 12.4)), (side_stand_length, 2.6, 5.8), stand)
        cube(f"{label}_audience_middle_tier", (pool_center_x, 4.55, side * (POOL_WIDTH / 2 + 19.2)), (side_stand_length, 2.9, 6.2), stand)
        cube(f"{label}_audience_upper_tier", (pool_center_x, 6.9, side * (POOL_WIDTH / 2 + 27.0)), (side_stand_length, 3.2, 7.0), stand)
        cube(f"{label}_audience_back_wall", (pool_center_x, 8.35, side * (POOL_WIDTH / 2 + 31.0)), (side_stand_length, 2.7, 0.7), stand)

    cube("start_dark_lower_arena_wall", (-7.45, 1.0, 0), (0.9, 1.55, end_stand_width), deck_dark)
    cube("finish_dark_lower_arena_wall", (RACE_LENGTH + 7.45, 1.0, 0), (0.9, 1.55, end_stand_width), deck_dark)
    cube("start_blue_banner_band", (-8.05, 1.95, 0), (0.2, 0.44, end_stand_width), banner)
    cube("finish_blue_banner_band", (RACE_LENGTH + 8.05, 1.95, 0), (0.2, 0.44, end_stand_width), banner)
    for side, label, base_x in ((-1, "start", 0), (1, "finish", RACE_LENGTH)):
        cube(f"{label}_audience_lower_tier", (base_x + side * 13.0, 2.35, 0), (7.2, 2.6, end_stand_width), stand)
        cube(f"{label}_audience_middle_tier", (base_x + side * 21.0, 4.55, 0), (8.0, 2.9, end_stand_width), stand)
        cube(f"{label}_audience_upper_tier", (base_x + side * 30.0, 6.9, 0), (9.0, 3.2, end_stand_width), stand)
        cube(f"{label}_audience_back_wall", (base_x + side * 35.1, 8.35, 0), (0.7, 2.7, end_stand_width), stand)

    cube("flat_transparent_water_plane", (pool_center_x, 0.405, 0), (POOL_LENGTH, 0.035, POOL_WIDTH), water)

    for lane in range(LANE_COUNT):
        z = lane_center_z(lane)
        cube(f"lane_{lane + 1}_start_block_base", (-2.8, 0.85, z), (0.95, 0.55, 0.78), block_face)
        top = cube(f"lane_{lane + 1}_start_block_top", (-3.02, 1.17, z), (0.9, 0.18, 0.72), block_top)
        top.rotation_euler[1] = math.radians(-6)

    for boundary in range(LANE_COUNT + 1):
        z = -POOL_WIDTH / 2 + LANE_WIDTH * boundary
        rope_mat = red if boundary in (0, LANE_COUNT) else blue
        core_width = 0.045 if boundary in (0, LANE_COUNT) else 0.03
        rope_start_x = -1.75
        rope_end_x = RACE_LENGTH + 0.85
        cube(
            f"lane_rope_{boundary}_core",
            ((rope_start_x + rope_end_x) * 0.5, 0.48, z),
            (rope_end_x - rope_start_x, core_width, core_width),
            rope_mat,
        )
        for i, x in enumerate([rope_start_x + 0.35 + n * 6.45 for n in range(17)]):
            material = red if (i + boundary) % 2 == 0 else white
            cube(f"lane_rope_{boundary}_float_{i:02d}", (x, 0.5, z), (0.58, 0.18, 0.18), material)

    for x in (0, RACE_LENGTH):
        for z in (-POOL_WIDTH / 2 - 0.82, POOL_WIDTH / 2 + 0.82):
            add_lowpoly_cylinder(
                f"corner_post_{x:.0f}_{z:.0f}",
                (x, 0.9, z),
                0.1,
                0.95,
                white,
                vertices=8,
            )


def setup_camera_and_light():
    bpy.ops.object.light_add(type="SUN", location=(35, -25, 40))
    sun = bpy.context.object
    sun.name = "preview_sun"
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), 0, math.radians(35))

    bpy.ops.object.camera_add(location=(52, -34, 34))
    camera = bpy.context.object
    bpy.context.scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 64
    direction = mathutils.Vector((50, 0, 0.2)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.resolution_x = 1600
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.world.color = (0.78, 0.86, 0.92)


def export_assets():
    OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    OUT_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        export_apply=True,
        export_materials="EXPORT",
    )
    bpy.context.scene.render.filepath = str(OUT_PREVIEW)
    bpy.ops.render.render(write_still=True)


def main():
    clear_scene()
    build_pool()
    optimize_static_meshes()
    setup_camera_and_light()
    export_assets()


if __name__ == "__main__":
    main()
