import json
import math
import os

import bpy
from mathutils import Vector


PROJECT_ROOT = r"F:\myworkspace\cocosProjects\SpeedSwimming"
TARGET_GLB = os.path.join(PROJECT_ROOT, "assets", "race", "models", "UserSwimmer0621_2.glb")
MIXAMO_FBX = os.path.join(PROJECT_ROOT, "tools", "mixamo_raw", "Treading Water.fbx")
OUTPUT_GLB = os.path.join(PROJECT_ROOT, "assets", "race", "models", "UserSwimmer0621_2MixamoSwimming.glb")

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


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes):
        for datablock in list(collection):
            collection.remove(datablock)


def import_inputs(target_glb=TARGET_GLB, mixamo_fbx=MIXAMO_FBX):
    existing = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=target_glb)
    for obj in set(bpy.context.scene.objects) - existing:
        obj.name = "Target_" + obj.name
    bpy.ops.import_scene.fbx(filepath=mixamo_fbx)


def find_armatures():
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    target = next(obj for obj in armatures if "Root" in obj.pose.bones and "Hip" in obj.pose.bones)
    source = next(obj for obj in armatures if SOURCE_HIPS in obj.pose.bones)
    return target, source


SOURCE_HIPS = "mixamorig:Hips"
TARGET_HIP = "Hip"
SOURCE_CONTACT_BONES = ["mixamorig:LeftFoot", "mixamorig:LeftToeBase", "mixamorig:RightFoot", "mixamorig:RightToeBase"]
TARGET_CONTACT_BONES = ["L_Foot", "L_ToeBase", "R_Foot", "R_ToeBase"]
PRESERVE_TARGET_ROLL_BONES = {"L_Clavicle", "R_Clavicle"}


def world_rest_matrix(armature, bone_name):
    return armature.matrix_world @ armature.data.bones[bone_name].matrix_local


def world_pose_matrix(armature, bone_name):
    return armature.matrix_world @ armature.pose.bones[bone_name].matrix


def bone_head_world(armature, bone_name, posed):
    bone = armature.pose.bones[bone_name] if posed else armature.data.bones[bone_name]
    head = bone.head if posed else bone.head_local
    return armature.matrix_world @ head


def retarget_scale(target, source):
    target_length = (bone_head_world(target, TARGET_HIP, False) - bone_head_world(target, "L_Foot", False)).length
    source_length = (bone_head_world(source, SOURCE_HIPS, False) - bone_head_world(source, "mixamorig:LeftFoot", False)).length
    return target_length / max(0.000001, source_length)


def reset_target_pose(target):
    for pose_bone in target.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.location = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)
        pose_bone.rotation_quaternion = (1, 0, 0, 0)


def apply_world_space_pose(target, source, mapped, scale_ratio):
    reset_target_pose(target)
    bpy.context.view_layer.update()

    source_rest_hip = bone_head_world(source, SOURCE_HIPS, False)
    source_pose_hip = bone_head_world(source, SOURCE_HIPS, True)
    hip_displacement_world = (source_pose_hip - source_rest_hip) * scale_ratio
    target_rest_hip_world = bone_head_world(target, TARGET_HIP, False)
    target_hip_armature = target.matrix_world.inverted() @ (target_rest_hip_world + hip_displacement_world)

    ordered = sorted(mapped, key=lambda pair: len(target.data.bones[pair[1]].parent_recursive))
    for src_name, dst_name in ordered:
        if dst_name in PRESERVE_TARGET_ROLL_BONES:
            continue
        source_bone = source.pose.bones[src_name]
        target_bone = target.pose.bones[dst_name]
        source_direction = source.matrix_world.to_3x3() @ (source_bone.tail - source_bone.head)
        target_direction = target.matrix_world.to_3x3() @ (target_bone.tail - target_bone.head)
        source_direction.normalize()
        target_direction.normalize()
        swing = target_direction.rotation_difference(source_direction)
        desired_world_rotation = swing @ world_pose_matrix(target, dst_name).to_quaternion()
        desired_armature_rotation = target.matrix_world.to_quaternion().inverted() @ desired_world_rotation

        pose_bone = target_bone
        pose_matrix = desired_armature_rotation.to_matrix().to_4x4()
        pose_matrix.translation = target_hip_armature if dst_name == TARGET_HIP else pose_bone.head.copy()
        pose_bone.matrix = pose_matrix
        bpy.context.view_layer.update()

    max_direction_error_degrees = 0.0
    for src_name, dst_name in mapped:
        if dst_name in PRESERVE_TARGET_ROLL_BONES:
            continue
        source_bone = source.pose.bones[src_name]
        target_bone = target.pose.bones[dst_name]
        source_direction = source.matrix_world.to_3x3() @ (source_bone.tail - source_bone.head)
        target_direction = target.matrix_world.to_3x3() @ (target_bone.tail - target_bone.head)
        source_direction.normalize()
        target_direction.normalize()
        angle = source_direction.angle(target_direction, 0.0)
        max_direction_error_degrees = max(max_direction_error_degrees, angle * 180.0 / 3.141592653589793)
    max_preserved_bone_rotation_degrees = 0.0
    for bone_name in PRESERVE_TARGET_ROLL_BONES:
        quaternion = target.pose.bones[bone_name].rotation_quaternion.normalized()
        angle = 2.0 * math.acos(max(-1.0, min(1.0, abs(quaternion.w))))
        max_preserved_bone_rotation_degrees = max(max_preserved_bone_rotation_degrees, math.degrees(angle))

    source_ground = min(bone_head_world(source, name, False).z for name in SOURCE_CONTACT_BONES)
    source_min_foot = min(bone_head_world(source, name, True).z for name in SOURCE_CONTACT_BONES)
    target_ground = min(bone_head_world(target, name, False).z for name in TARGET_CONTACT_BONES)
    target_min_foot = min(bone_head_world(target, name, True).z for name in TARGET_CONTACT_BONES)
    grounded = source_min_foot <= source_ground + 0.025
    correction_world = target_ground - target_min_foot if grounded else 0.0
    if grounded and abs(correction_world) > 0.000001:
        correction_armature = target.matrix_world.inverted().to_3x3() @ Vector((0, 0, correction_world))
        hip_matrix = target.pose.bones[TARGET_HIP].matrix.copy()
        hip_matrix.translation += correction_armature
        target.pose.bones[TARGET_HIP].matrix = hip_matrix
        bpy.context.view_layer.update()
    return grounded, correction_world, max_direction_error_degrees, max_preserved_bone_rotation_degrees


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
    reset_target_pose(target)

    for src_name, dst_name in BONE_MAP.items():
        if dst_name in target.pose.bones and src_name in source.pose.bones:
            mapped.append((src_name, dst_name))

    action = bpy.data.actions.new("Swimming")
    target.animation_data_create()
    target.animation_data.action = action
    scale_ratio = retarget_scale(target, source)
    grounded_frames = 0
    max_ground_correction = 0.0
    max_direction_error_degrees = 0.0
    max_preserved_bone_rotation_degrees = 0.0

    for frame in range(bpy.context.scene.frame_start, bpy.context.scene.frame_end + 1):
        bpy.context.scene.frame_set(frame)
        grounded, correction, direction_error, preserved_rotation_error = apply_world_space_pose(target, source, mapped, scale_ratio)
        grounded_frames += 1 if grounded else 0
        max_ground_correction = max(max_ground_correction, abs(correction))
        max_direction_error_degrees = max(max_direction_error_degrees, direction_error)
        max_preserved_bone_rotation_degrees = max(max_preserved_bone_rotation_degrees, preserved_rotation_error)
        for src_name, dst_name in mapped:
            pose_bone = target.pose.bones[dst_name]
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        target.pose.bones[TARGET_HIP].keyframe_insert(data_path="location", frame=frame)

    bpy.context.scene.frame_set(bpy.context.scene.frame_start)
    return mapped, {
        "frame_start": bpy.context.scene.frame_start,
        "frame_end": bpy.context.scene.frame_end,
        "sample_count": bpy.context.scene.frame_end - bpy.context.scene.frame_start + 1,
        "scale_ratio": scale_ratio,
        "grounded_frames": grounded_frames,
        "max_ground_correction": max_ground_correction,
        "max_direction_error_degrees": max_direction_error_degrees,
        "max_preserved_bone_rotation_degrees": max_preserved_bone_rotation_degrees,
    }


def cleanup_and_export(target, source, output_glb=OUTPUT_GLB):
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
        filepath=output_glb,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_frame_range=True,
        export_frame_step=1,
        export_force_sampling=True,
        export_bake_animation=True,
    )


def main(target_glb=TARGET_GLB, mixamo_fbx=MIXAMO_FBX, output_glb=OUTPUT_GLB):
    clear_scene()
    import_inputs(target_glb, mixamo_fbx)
    target, source = find_armatures()
    mapped, diagnostics = bake_target_action(target, source)
    cleanup_and_export(target, source, output_glb)
    print(json.dumps({
        "source": mixamo_fbx,
        "output": output_glb,
        "mapped_bones": len(mapped),
        "mapped": mapped,
        "diagnostics": diagnostics,
    }, indent=2))
    return {
        "source": mixamo_fbx,
        "output": output_glb,
        "mapped_bones": len(mapped),
        "mapped": mapped,
        "diagnostics": diagnostics,
    }


if __name__ == "__main__":
    main()
