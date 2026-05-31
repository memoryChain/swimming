import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
FBX = ROOT / "assets/resources/models/KenneyCharacters/characterMedium.fbx"
TEXTURE = ROOT / "assets/resources/models/KenneyCharacters/humanMaleA.png"
OUT_GLB = ROOT / "assets/resources/models/FreestyleCartoonAthleteV2.glb"
OUT_BLEND = ROOT / "tools/FreestyleCartoonAthleteV2.blend"


def mat(name, color, roughness=0.62):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0
    return material


def texture_mat(name, image_path, roughness=0.62):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    image = bpy.data.images.load(str(image_path))
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0
    return material


def set_pose(armature):
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    rotations = {
        "Spine": (math.radians(-4), 0, 0),
        "Chest": (math.radians(6), 0, 0),
        "UpperChest": (math.radians(4), 0, 0),
        "Neck": (math.radians(-10), 0, 0),
        "Head": (math.radians(-5), 0, 0),
        # Keep the pose readable and conservative. The full freestyle cycle is in the action below.
        "LeftArm": (0, math.radians(-42), math.radians(28)),
        "LeftForeArm": (0, math.radians(-20), math.radians(8)),
        "LeftHand": (0, 0, math.radians(-6)),
        "RightArm": (0, math.radians(42), math.radians(-28)),
        "RightForeArm": (0, math.radians(20), math.radians(-8)),
        "RightHand": (0, 0, math.radians(6)),
        "LeftUpLeg": (math.radians(6), 0, 0),
        "LeftLeg": (math.radians(-10), 0, 0),
        "LeftFoot": (math.radians(8), 0, 0),
        "RightUpLeg": (math.radians(-6), 0, 0),
        "RightLeg": (math.radians(10), 0, 0),
        "RightFoot": (math.radians(-8), 0, 0),
    }
    for name, euler in rotations.items():
        bone = armature.pose.bones.get(name)
        if bone:
            bone.rotation_mode = "XYZ"
            bone.rotation_euler = euler
    bpy.ops.object.mode_set(mode="OBJECT")


def add_accessories(armature):
    character_texture = texture_mat("kenney_human_male_texture", TEXTURE)
    cap = mat("swimcap_yellow", (1.0, 0.82, 0.08, 1))
    dark = mat("goggles_black", (0.02, 0.025, 0.035, 1))
    lens = mat("goggle_lens_blue", (0.05, 0.55, 0.95, 1), 0.35)

    mesh = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith("characterMedium"))
    mesh.data.materials.clear()
    mesh.data.materials.append(character_texture)
    for poly in mesh.data.polygons:
        poly.material_index = 0

    def parent_to_head(obj):
        obj.parent = armature
        obj.parent_type = "BONE"
        obj.parent_bone = "Head"

    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(0, 0, 0))
    cap_obj = bpy.context.object
    cap_obj.name = "SimpleSwimCap"
    cap_obj.scale = (0.28, 0.2, 0.16)
    cap_obj.data.materials.append(cap)
    parent_to_head(cap_obj)
    cap_obj.location = (0, -0.02, 0.17)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    band = bpy.context.object
    band.name = "SimpleGoggleBand"
    band.dimensions = (0.44, 0.035, 0.04)
    band.data.materials.append(dark)
    parent_to_head(band)
    band.location = (0, -0.2, 0.02)

    for name, x in [("LeftGoggleLens", -0.12), ("RightGoggleLens", 0.12)]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=(0, 0, 0))
        eye = bpy.context.object
        eye.name = name
        eye.scale = (0.07, 0.025, 0.045)
        eye.data.materials.append(lens)
        parent_to_head(eye)
        eye.location = (x, -0.22, 0.02)

    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            try:
                bpy.ops.object.shade_smooth()
            except RuntimeError:
                pass
            obj.select_set(False)


def apply_current_pose_as_rest(armature):
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def create_actions(armature):
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 48

    def key(frame, values):
        scene.frame_set(frame)
        for name, euler in values.items():
            bone = armature.pose.bones.get(name)
            if bone:
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = tuple(math.radians(v) for v in euler)
                bone.keyframe_insert("rotation_euler", frame=frame)

    action = bpy.data.actions.new("FreestyleFull")
    armature.animation_data_create()
    armature.animation_data.action = action
    key(1, {
        "LeftArm": (0, -64, 18), "LeftForeArm": (0, -22, 6), "LeftHand": (0, 0, -4),
        "RightArm": (0, 42, -34), "RightForeArm": (0, 56, -8), "RightHand": (0, 0, 4),
        "LeftUpLeg": (16, 0, 0), "LeftLeg": (-30, 0, 0), "LeftFoot": (18, 0, 0),
        "RightUpLeg": (-16, 0, 0), "RightLeg": (30, 0, 0), "RightFoot": (-18, 0, 0),
    })
    key(16, {
        "LeftArm": (0, -18, 42), "LeftForeArm": (0, -58, 8), "LeftHand": (0, 0, 6),
        "RightArm": (0, 64, -18), "RightForeArm": (0, 22, -6), "RightHand": (0, 0, 4),
        "LeftUpLeg": (-16, 0, 0), "LeftLeg": (30, 0, 0), "LeftFoot": (-18, 0, 0),
        "RightUpLeg": (16, 0, 0), "RightLeg": (-30, 0, 0), "RightFoot": (18, 0, 0),
    })
    key(32, {
        "LeftArm": (0, -42, 34), "LeftForeArm": (0, -56, 8), "LeftHand": (0, 0, -4),
        "RightArm": (0, 18, -42), "RightForeArm": (0, 58, -8), "RightHand": (0, 0, -6),
        "LeftUpLeg": (16, 0, 0), "LeftLeg": (-30, 0, 0), "LeftFoot": (18, 0, 0),
        "RightUpLeg": (-16, 0, 0), "RightLeg": (30, 0, 0), "RightFoot": (-18, 0, 0),
    })
    key(48, {
        "LeftArm": (0, -64, 18), "LeftForeArm": (0, -22, 6), "LeftHand": (0, 0, -4),
        "RightArm": (0, 42, -34), "RightForeArm": (0, 56, -8), "RightHand": (0, 0, 4),
        "LeftUpLeg": (16, 0, 0), "LeftLeg": (-30, 0, 0), "LeftFoot": (18, 0, 0),
        "RightUpLeg": (-16, 0, 0), "RightLeg": (30, 0, 0), "RightFoot": (-18, 0, 0),
    })
    bpy.ops.object.mode_set(mode="OBJECT")


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.fbx(filepath=str(FBX))

    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    armature.name = "FreestyleCartoonAthleteRig"
    set_pose(armature)
    apply_current_pose_as_rest(armature)
    add_accessories(armature)
    create_actions(armature)

    armature.scale = (1.0, 1.0, 1.0)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        use_selection=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_apply=True,
    )
    print(f"EXPORT {OUT_GLB}")


if __name__ == "__main__":
    main()
