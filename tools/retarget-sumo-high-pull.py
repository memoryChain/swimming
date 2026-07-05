import json
import os

import bpy
from mathutils import Matrix


PROJECT_ROOT = r"F:\myworkspace\cocosProjects\SpeedSwimming"
TARGET_GLB = os.path.join(PROJECT_ROOT, "assets", "resources", "models", "UserSwimmer0621_2.glb")
MIXAMO_FBX = os.path.join(PROJECT_ROOT, "tools", "mixamo_raw", "Sumo High Pull.fbx")
OUTPUT_GLB = os.path.join(PROJECT_ROOT, "assets", "resources", "models", "UserSwimmer0621_2SumoHighPull.glb")

BONE_MAP = {
    "mixamorig:Hips": "Hip",
    "mixamorig:Spine": "Waist",
    "mixamorig:Spine1": "Spine01",
    "mixamorig:Spine2": "Spine02",
    "mixamorig:Neck": "NeckTwist01",
    "mixamorig:Head": "Head",
    "mixamorig:LeftShoulder": "L_Clavicle",
    "mixamorig:LeftArm": "L_Upperarm",
    "mixamorig:LeftForeArm": "L_Forearm",
    "mixamorig:LeftHand": "L_Hand",
    "mixamorig:RightShoulder": "R_Clavicle",
    "mixamorig:RightArm": "R_Upperarm",
    "mixamorig:RightForeArm": "R_Forearm",
    "mixamorig:RightHand": "R_Hand",
    "mixamorig:LeftUpLeg": "L_Thigh",
    "mixamorig:LeftLeg": "L_Calf",
    "mixamorig:LeftFoot": "L_Foot",
    "mixamorig:LeftToeBase": "L_ToeBase",
    "mixamorig:RightUpLeg": "R_Thigh",
    "mixamorig:RightLeg": "R_Calf",
    "mixamorig:RightFoot": "R_Foot",
    "mixamorig:RightToeBase": "R_ToeBase",
}

BONE_CHILD = {
    "mixamorig:Hips": "mixamorig:Spine",
    "mixamorig:Spine": "mixamorig:Spine1",
    "mixamorig:Spine1": "mixamorig:Spine2",
    "mixamorig:Spine2": "mixamorig:Neck",
    "mixamorig:Neck": "mixamorig:Head",
    "mixamorig:LeftShoulder": "mixamorig:LeftArm",
    "mixamorig:LeftArm": "mixamorig:LeftForeArm",
    "mixamorig:LeftForeArm": "mixamorig:LeftHand",
    "mixamorig:RightShoulder": "mixamorig:RightArm",
    "mixamorig:RightArm": "mixamorig:RightForeArm",
    "mixamorig:RightForeArm": "mixamorig:RightHand",
    "mixamorig:LeftUpLeg": "mixamorig:LeftLeg",
    "mixamorig:LeftLeg": "mixamorig:LeftFoot",
    "mixamorig:LeftFoot": "mixamorig:LeftToeBase",
    "mixamorig:RightUpLeg": "mixamorig:RightLeg",
    "mixamorig:RightLeg": "mixamorig:RightFoot",
    "mixamorig:RightFoot": "mixamorig:RightToeBase",
}

RETARGET_ORDER = [
    "mixamorig:Spine",
    "mixamorig:Spine1",
    "mixamorig:Spine2",
    "mixamorig:Neck",
    "mixamorig:LeftShoulder",
    "mixamorig:LeftArm",
    "mixamorig:LeftForeArm",
    "mixamorig:RightShoulder",
    "mixamorig:RightArm",
    "mixamorig:RightForeArm",
    "mixamorig:LeftUpLeg",
    "mixamorig:LeftLeg",
    "mixamorig:RightUpLeg",
    "mixamorig:RightLeg",
]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_inputs():
    bpy.ops.import_scene.gltf(filepath=TARGET_GLB)
    for obj in bpy.context.scene.objects:
        obj.name = "Target_" + obj.name
    bpy.ops.import_scene.fbx(filepath=MIXAMO_FBX)


def find_armatures():
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    target = next(obj for obj in armatures if obj.name.startswith("Target_"))
    source = next(obj for obj in armatures if not obj.name.startswith("Target_"))
    return target, source


def bake_target_action(target, source):
    source_action = source.animation_data.action if source.animation_data and source.animation_data.action else None
    if not source_action:
        raise RuntimeError("Mixamo source action missing")

    bpy.context.scene.frame_start = int(source_action.frame_range[0])
    bpy.context.scene.frame_end = int(source_action.frame_range[1])
    bpy.context.scene.render.fps = 30

    mapped = []
    for pose_bone in target.pose.bones:
        for constraint in list(pose_bone.constraints):
            pose_bone.constraints.remove(constraint)
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.location = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)
        pose_bone.rotation_quaternion = (1, 0, 0, 0)

    for src_name, dst_name in BONE_MAP.items():
        if dst_name in target.pose.bones and src_name in source.pose.bones:
            mapped.append((src_name, dst_name))

    action = bpy.data.actions.new("SumoHighPull")
    target.animation_data_create()
    target.animation_data.action = action

    for frame in range(bpy.context.scene.frame_start, bpy.context.scene.frame_end + 1):
        bpy.context.scene.frame_set(frame)
        reset_target_pose(target)
        apply_direction_matched_pose(target, source)
        for _, dst_name in mapped:
            target.pose.bones[dst_name].keyframe_insert(data_path="rotation_quaternion", frame=frame)

    bpy.context.scene.frame_set(bpy.context.scene.frame_end)
    return mapped


def reset_target_pose(target):
    for pose_bone in target.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.location = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)
        pose_bone.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()


def pose_head_world(armature, bone_name):
    return armature.matrix_world @ armature.pose.bones[bone_name].head


def source_bone_direction_world(source, src_name):
    child_name = BONE_CHILD.get(src_name)
    if child_name and child_name in source.pose.bones:
        return pose_head_world(source, child_name) - pose_head_world(source, src_name)
    pose_bone = source.pose.bones[src_name]
    return source.matrix_world.to_3x3() @ (pose_bone.tail - pose_bone.head)


def apply_direction_matched_pose(target, source):
    # Match each major limb/spine segment by world-space bone direction. This avoids
    # directly copying Mixamo local quaternions onto a skeleton with different bone axes.
    for src_name in RETARGET_ORDER:
        dst_name = BONE_MAP.get(src_name)
        if not dst_name or src_name not in source.pose.bones or dst_name not in target.pose.bones:
            continue
        desired = source_bone_direction_world(source, src_name)
        if desired.length <= 0.000001:
            continue
        desired.normalize()

        pose_bone = target.pose.bones[dst_name]
        current = (target.matrix_world @ pose_bone.tail) - (target.matrix_world @ pose_bone.head)
        if current.length <= 0.000001:
            continue
        current.normalize()

        delta = current.rotation_difference(desired)
        head = target.matrix_world @ pose_bone.head
        world_matrix = (
            Matrix.Translation(head)
            @ delta.to_matrix().to_4x4()
            @ Matrix.Translation(-head)
            @ (target.matrix_world @ pose_bone.matrix)
        )
        pose_bone.matrix = target.matrix_world.inverted() @ world_matrix
        bpy.context.view_layer.update()


def cleanup_and_export(target, source):
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.ops.object.delete()

    target.name = "Armature"
    target.data.name = "Armature"
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.name.startswith("Target_"):
            obj.name = obj.name.replace("Target_", "")

    target_action = target.animation_data.action if target.animation_data else None
    for action in list(bpy.data.actions):
        if action != target_action:
            bpy.data.actions.remove(action)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_frame_range=True,
        export_frame_step=1,
        export_force_sampling=True,
        export_bake_animation=True,
    )


def main():
    clear_scene()
    import_inputs()
    target, source = find_armatures()
    mapped = bake_target_action(target, source)
    cleanup_and_export(target, source)
    print(json.dumps({
        "source": MIXAMO_FBX,
        "output": OUTPUT_GLB,
        "mapped_bones": len(mapped),
        "mapped": mapped,
        "frame_start": bpy.context.scene.frame_start,
        "frame_end": bpy.context.scene.frame_end,
    }, indent=2))


if __name__ == "__main__":
    main()
