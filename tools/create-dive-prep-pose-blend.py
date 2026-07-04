import os
import json
import re

import bpy


PROJECT_ROOT = r"F:\myworkspace\cocosProjects\SpeedSwimming"
SOURCE_GLB = os.path.join(PROJECT_ROOT, "assets", "resources", "models", "UserSwimmer0621_2.glb")
POSE_TS = os.path.join(PROJECT_ROOT, "assets", "scripts", "character", "DivePrepPoseCurve.ts")
OUTPUT_BLEND = os.path.join(PROJECT_ROOT, "tools", "UserSwimmer0621_2DivePrepPose.blend")


def clear_scene():
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.ops.object.mode_set.poll() else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def find_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            return obj
    raise RuntimeError("Imported swimmer armature not found")


def make_reference_plane(name, location, scale, color):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    material = bpy.data.materials.new(name=f"{name}Material")
    material.diffuse_color = color
    obj.data.materials.append(material)
    return obj


def load_current_pose_sample():
    with open(POSE_TS, "r", encoding="utf-8") as file:
        source = file.read()
    match = re.search(
        r"export const DIVE_PREP_POSE_SAMPLE: DivePrepPoseSample = (\{.*?\}) as const;",
        source,
        re.DOTALL,
    )
    if not match:
        raise RuntimeError(f"Could not parse dive prep sample from {POSE_TS}")
    return json.loads(match.group(1))


def apply_pose_sample(armature):
    sample = load_current_pose_sample()
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")

    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"

    for bone_name, rotation in sample["rotations"].items():
        bone = armature.pose.bones.get(bone_name)
        if not bone:
            continue
        x, y, z, w = rotation
        bone.rotation_quaternion = (w, x, y, z)

    armature.animation_data_clear()
    bpy.context.scene.frame_start = int(sample["sampleFrame"])
    bpy.context.scene.frame_end = int(sample["sampleFrame"])
    bpy.context.scene.frame_set(int(sample["sampleFrame"]))
    bpy.context.view_layer.update()


def main():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=SOURCE_GLB)
    armature = find_armature()
    armature.name = "DivePrepPose_Armature"
    armature.data.name = "DivePrepPose_ArmatureData"
    apply_pose_sample(armature)

    make_reference_plane("DivePrepWaterPlane", (0, 0, -0.02), (2.2, 1.35, 0.01), (0.1, 0.6, 1.0, 0.25))
    make_reference_plane("DivePrepCenterLine", (0, 0, 0.002), (2.2, 0.015, 0.012), (1, 1, 1, 0.8))

    light_data = bpy.data.lights.new("DivePrepKeyLight", type="AREA")
    light = bpy.data.objects.new("DivePrepKeyLight", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (0, -3, 4)
    light.rotation_euler = (1.0, 0, 0)
    light_data.energy = 500
    light_data.size = 4

    camera_data = bpy.data.cameras.new("DivePrepReviewCamera")
    camera = bpy.data.objects.new("DivePrepReviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0, -3.2, 1.35)
    camera.rotation_euler = (1.22, 0, 0)
    camera_data.lens = 45
    bpy.context.scene.camera = camera

    note = bpy.data.texts.new("README_DivePrepPose")
    note.write(
        "Adjust the swimmer in Pose Mode on DivePrepPose_Armature.\n"
        "Keep pose bones in QUATERNION mode.\n"
        "This file starts from the current game sample on the aligned UserSwimmer0621_2 rig.\n"
        "When done, ask Codex to export this pose back into the game.\n"
        "Useful bones: L_Clavicle/R_Clavicle, L_Upperarm/R_Upperarm, L_Forearm/R_Forearm, Hip, Waist, Spine01, Spine02, Head.\n"
    )

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    print(f"Saved {OUTPUT_BLEND}")


if __name__ == "__main__":
    main()
