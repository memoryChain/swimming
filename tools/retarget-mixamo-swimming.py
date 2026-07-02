import json
import os

import bpy


PROJECT_ROOT = r"F:\myworkspace\cocosProjects\SpeedSwimming"
TARGET_GLB = os.path.join(PROJECT_ROOT, "assets", "resources", "models", "UserSwimmer0621_2.glb")
MIXAMO_FBX = os.path.join(PROJECT_ROOT, "tools", "mixamo_raw", "Treading Water.fbx")
OUTPUT_GLB = os.path.join(PROJECT_ROOT, "assets", "resources", "models", "UserSwimmer0621_2MixamoSwimming.glb")

BONE_MAP = {
    "mixamorig:Hips": "Root",
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


def local_rest_matrix(armature, bone_name):
    bone = armature.data.bones[bone_name]
    if bone.parent:
        return bone.parent.matrix_local.inverted() @ bone.matrix_local
    return bone.matrix_local.copy()


def local_pose_matrix(armature, bone_name):
    pose_bone = armature.pose.bones[bone_name]
    if pose_bone.parent:
        return pose_bone.parent.matrix.inverted() @ pose_bone.matrix
    return pose_bone.matrix.copy()


def rotation_delta_from_source(source, src_name):
    source_rest = local_rest_matrix(source, src_name)
    source_pose = local_pose_matrix(source, src_name)
    delta = source_rest.inverted() @ source_pose
    return delta.to_quaternion()


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

    action = bpy.data.actions.new("Swimming")
    target.animation_data_create()
    target.animation_data.action = action

    for frame in range(bpy.context.scene.frame_start, bpy.context.scene.frame_end + 1):
        bpy.context.scene.frame_set(frame)
        for src_name, dst_name in mapped:
            pose_bone = target.pose.bones[dst_name]
            pose_bone.rotation_quaternion = rotation_delta_from_source(source, src_name)
            pose_bone.location = (0, 0, 0)
            pose_bone.scale = (1, 1, 1)
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)

    bpy.context.scene.frame_set(bpy.context.scene.frame_start)
    return mapped


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
        "output": OUTPUT_GLB,
        "mapped_bones": len(mapped),
        "mapped": mapped,
    }, indent=2))


if __name__ == "__main__":
    main()
