import json
import math
import os

import bpy
from mathutils import Quaternion, Vector


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
ANIMATE_CLAVICLE_SOURCE_FILES = {"Arm Stretching.fbx", "Twist Dance.fbx"}
# YMCA needs shoulder motion, but its source shoulder elevation deforms this
# swimmer's neck-to-shoulder silhouette. Transfer only the source-relative yaw
# around each posed target parent's local up axis so the target shoulder slope
# stays identical to its normal rig while the clavicles still move in depth.
RELATIVE_HORIZONTAL_CLAVICLE_SOURCE_FILES = {"Ymca Dance.fbx"}
FOOT_SURFACE_TOLERANCE = 0.0002


def world_rest_matrix(armature, bone_name):
    return armature.matrix_world @ armature.data.bones[bone_name].matrix_local


def world_pose_matrix(armature, bone_name):
    return armature.matrix_world @ armature.pose.bones[bone_name].matrix


def bone_head_world(armature, bone_name, posed):
    bone = armature.pose.bones[bone_name] if posed else armature.data.bones[bone_name]
    head = bone.head if posed else bone.head_local
    return armature.matrix_world @ head


def source_relative_direction_swing(source, bone_name):
    rest_bone = source.data.bones[bone_name]
    pose_bone = source.pose.bones[bone_name]
    rest_direction = source.matrix_world.to_3x3() @ (rest_bone.tail_local - rest_bone.head_local)
    pose_direction = source.matrix_world.to_3x3() @ (pose_bone.tail - pose_bone.head)
    rest_direction.normalize()
    pose_direction.normalize()

    if rest_bone.parent and pose_bone.parent:
        parent_rest_rotation = world_rest_matrix(source, rest_bone.parent.name).to_quaternion()
        parent_pose_rotation = world_pose_matrix(source, pose_bone.parent.name).to_quaternion()
        parent_motion = parent_pose_rotation @ parent_rest_rotation.inverted()
        pose_direction = parent_motion.inverted() @ pose_direction
        pose_direction.normalize()
    return rest_direction.rotation_difference(pose_direction)


def source_relative_horizontal_angle(source, bone_name):
    rest_bone = source.data.bones[bone_name]
    pose_bone = source.pose.bones[bone_name]
    rest_direction = source.matrix_world.to_3x3() @ (rest_bone.tail_local - rest_bone.head_local)
    pose_direction = source.matrix_world.to_3x3() @ (pose_bone.tail - pose_bone.head)
    rest_direction.normalize()
    pose_direction.normalize()

    if rest_bone.parent and pose_bone.parent:
        parent_rest_rotation = world_rest_matrix(source, rest_bone.parent.name).to_quaternion()
        parent_pose_rotation = world_pose_matrix(source, pose_bone.parent.name).to_quaternion()
        parent_motion = parent_pose_rotation @ parent_rest_rotation.inverted()
        pose_direction = parent_motion.inverted() @ pose_direction
        pose_direction.normalize()

    rest_horizontal = Vector((rest_direction.x, rest_direction.y, 0.0))
    pose_horizontal = Vector((pose_direction.x, pose_direction.y, 0.0))
    if rest_horizontal.length <= 0.000001 or pose_horizontal.length <= 0.000001:
        return 0.0
    rest_horizontal.normalize()
    pose_horizontal.normalize()
    cross_z = rest_horizontal.x * pose_horizontal.y - rest_horizontal.y * pose_horizontal.x
    dot = max(-1.0, min(1.0, rest_horizontal.dot(pose_horizontal)))
    return math.atan2(cross_z, dot)


def target_parent_up_axis(target, bone_name):
    pose_bone = target.pose.bones[bone_name]
    if not pose_bone.parent:
        return Vector((0.0, 0.0, 1.0))
    parent_pose_rotation = world_pose_matrix(target, pose_bone.parent.name).to_quaternion()
    up_axis = parent_pose_rotation @ Vector((0.0, 0.0, 1.0))
    up_axis.normalize()
    return up_axis


def parent_local_bone_elevation_degrees(armature, bone_name, posed):
    if posed:
        bone = armature.pose.bones[bone_name]
        direction = bone.tail - bone.head
        if bone.parent:
            direction = bone.parent.matrix.inverted().to_3x3() @ direction
    else:
        bone = armature.data.bones[bone_name]
        direction = bone.tail_local - bone.head_local
        if bone.parent:
            direction = bone.parent.matrix_local.inverted().to_3x3() @ direction
    direction.normalize()
    return math.degrees(math.asin(max(-1.0, min(1.0, direction.z))))


def retarget_scale(target, source):
    target_length = (bone_head_world(target, TARGET_HIP, False) - bone_head_world(target, "L_Foot", False)).length
    source_length = (bone_head_world(source, SOURCE_HIPS, False) - bone_head_world(source, "mixamorig:LeftFoot", False)).length
    return target_length / max(0.000001, source_length)


def quaternion_delta_degrees(left, right):
    left = left.normalized()
    right = right.normalized()
    dot = abs(sum(a * b for a, b in zip(left, right)))
    return math.degrees(2.0 * math.acos(max(0.0, min(1.0, dot))))


def quaternion_identity_degrees(quaternion):
    quaternion = quaternion.normalized()
    return math.degrees(2.0 * math.acos(max(0.0, min(1.0, abs(quaternion.w)))))


def compact_frame_ranges(frames):
    if not frames:
        return []
    ranges = []
    start = previous = frames[0]
    for frame in frames[1:]:
        if frame != previous + 1:
            ranges.append([start, previous])
            start = frame
        previous = frame
    ranges.append([start, previous])
    return ranges


def reset_target_pose(target):
    for pose_bone in target.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.location = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)
        pose_bone.rotation_quaternion = (1, 0, 0, 0)


def target_foot_surface_data(target):
    """Find the skinned sole vertices for each target foot.

    Bone heads are useful for a generic rig audit, but they are not a valid
    ground-contact proxy for asymmetric scanned meshes.  MuscleMan's sole mesh
    is level in rest pose even though its toe-bone heads are not, so contact
    correction must be measured on the deformed mesh surface.
    """
    mesh = next((
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and any(
            modifier.type == "ARMATURE" and modifier.object == target
            for modifier in obj.modifiers
        )
    ), None)
    if not mesh:
        raise RuntimeError("target mesh with Armature modifier was not found")
    groups = {}
    for side in ("L", "R"):
        names = (f"{side}_Foot", f"{side}_ToeBase")
        indices = [mesh.vertex_groups[name].index for name in names if mesh.vertex_groups.get(name)]
        if len(indices) != 2:
            raise RuntimeError(f"target foot vertex groups missing for side {side}")
        groups[side] = [
            vertex.index for vertex in mesh.data.vertices
            if any(group.group in indices and group.weight > 0.05 for group in vertex.groups)
        ]
        if not groups[side]:
            raise RuntimeError(f"target foot has no weighted sole vertices for side {side}")
    return mesh, groups


def mesh_sole_heights(mesh, foot_vertices):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        return {
            side: min((evaluated.matrix_world @ evaluated_mesh.vertices[index].co).z for index in indices)
            for side, indices in foot_vertices.items()
        }
    finally:
        evaluated.to_mesh_clear()


def source_side_grounded(source, side):
    names = (
        f"mixamorig:{'Left' if side == 'L' else 'Right'}Foot",
        f"mixamorig:{'Left' if side == 'L' else 'Right'}ToeBase",
    )
    if not all(name in source.pose.bones for name in names):
        return False
    rest = min(bone_head_world(source, name, False).z for name in names)
    pose = min(bone_head_world(source, name, True).z for name in names)
    return pose - rest <= 0.025


def apply_mesh_foot_grounding(target, source, mesh, foot_vertices, rest_ground):
    """Plant only source-grounded feet on the target's actual sole plane.

    A shared hip translation first aligns the highest planted sole.  Any other
    planted sole is therefore below the contact plane and can be lifted with a
    stable two-bone IK solve; this avoids trying to extend a nearly straight
    leg beyond its reach.  Foot and toe world rotations are restored after IK,
    so the correction changes contact height without tilting the foot.

    The solver deliberately never pulls a source-airborne foot to ground.
    """
    grounded_sides = [side for side in ("L", "R") if source_side_grounded(source, side)]
    if not grounded_sides:
        return {"grounded_sides": [], "max_hover": 0.0, "max_leg_adjustment_degrees": 0.0}

    def shift_hip_world(delta_z):
        hip = target.pose.bones[TARGET_HIP]
        matrix = hip.matrix.copy()
        matrix.translation += target.matrix_world.inverted().to_3x3() @ Vector((0.0, 0.0, delta_z))
        hip.matrix = matrix
        bpy.context.view_layer.update()

    def set_world_rotation(pose_bone, rotation):
        armature_rotation = target.matrix_world.to_quaternion().inverted() @ rotation
        matrix = armature_rotation.to_matrix().to_4x4()
        matrix.translation = pose_bone.head.copy()
        pose_bone.matrix = matrix
        bpy.context.view_layer.update()

    def rotate_bone_toward(pose_bone, desired_direction):
        current_direction = target.matrix_world.to_3x3() @ (pose_bone.tail - pose_bone.head)
        if current_direction.length <= 0.000001 or desired_direction.length <= 0.000001:
            return
        current_direction.normalize()
        desired_direction.normalize()
        swing = current_direction.rotation_difference(desired_direction)
        set_world_rotation(
            pose_bone,
            swing @ world_pose_matrix(target, pose_bone.name).to_quaternion(),
        )

    def solve_leg_to_ankle(side, desired_ankle):
        thigh = target.pose.bones[f"{side}_Thigh"]
        calf = target.pose.bones[f"{side}_Calf"]
        foot = target.pose.bones[f"{side}_Foot"]
        toe = target.pose.bones[f"{side}_ToeBase"]
        thigh_before = world_pose_matrix(target, thigh.name).to_quaternion()
        calf_before = world_pose_matrix(target, calf.name).to_quaternion()
        foot_rotation = world_pose_matrix(target, foot.name).to_quaternion()
        toe_rotation = world_pose_matrix(target, toe.name).to_quaternion()

        hip = bone_head_world(target, thigh.name, True)
        knee = bone_head_world(target, calf.name, True)
        ankle = bone_head_world(target, foot.name, True)
        first_length = (knee - hip).length
        second_length = (ankle - knee).length
        target_vector = desired_ankle - hip
        target_distance = target_vector.length
        if target_distance <= 0.000001:
            return 0.0
        target_axis = target_vector.normalized()
        reachable_distance = min(
            first_length + second_length - 0.000001,
            max(abs(first_length - second_length) + 0.000001, target_distance),
        )

        # Preserve the current knee bend side.  The fallback uses the posed
        # thigh's local Z axis for the rare exactly-straight frame.
        current_knee_offset = knee - (hip + target_axis * (knee - hip).dot(target_axis))
        if current_knee_offset.length <= 0.00001:
            current_knee_offset = (
                world_pose_matrix(target, thigh.name).to_quaternion()
                @ Vector((0.0, 0.0, 1.0))
            )
            current_knee_offset -= target_axis * current_knee_offset.dot(target_axis)
        if current_knee_offset.length <= 0.00001:
            current_knee_offset = target_axis.cross(Vector((1.0, 0.0, 0.0)))
        current_knee_offset.normalize()

        along = (
            first_length * first_length
            - second_length * second_length
            + reachable_distance * reachable_distance
        ) / (2.0 * reachable_distance)
        bend_height = math.sqrt(max(0.0, first_length * first_length - along * along))
        desired_knee = (
            hip
            + target_axis * along
            + current_knee_offset * bend_height
        )
        rotate_bone_toward(thigh, desired_knee - hip)

        posed_knee = bone_head_world(target, calf.name, True)
        rotate_bone_toward(calf, desired_ankle - posed_knee)
        set_world_rotation(foot, foot_rotation)
        set_world_rotation(toe, toe_rotation)

        thigh_after = world_pose_matrix(target, thigh.name).to_quaternion()
        calf_after = world_pose_matrix(target, calf.name).to_quaternion()
        return max(
            quaternion_delta_degrees(thigh_before, thigh_after),
            quaternion_delta_degrees(calf_before, calf_after),
        )

    soles = mesh_sole_heights(mesh, foot_vertices)
    # Aligning the highest sole makes every remaining correction a reachable
    # knee bend rather than an impossible request to lengthen a straight leg.
    shift_hip_world(rest_ground - max(soles[side] for side in grounded_sides))
    max_adjustment = 0.0
    if len(grounded_sides) > 1:
        for side in grounded_sides:
            for _iteration in range(3):
                soles = mesh_sole_heights(mesh, foot_vertices)
                surface_error = rest_ground - soles[side]
                if abs(surface_error) <= FOOT_SURFACE_TOLERANCE:
                    break
                ankle = bone_head_world(target, f"{side}_Foot", True)
                max_adjustment = max(
                    max_adjustment,
                    solve_leg_to_ankle(
                        side,
                        ankle + Vector((0.0, 0.0, surface_error)),
                    ),
                )

    soles = mesh_sole_heights(mesh, foot_vertices)
    return {
        "grounded_sides": grounded_sides,
        "max_hover": max(abs(soles[side] - rest_ground) for side in grounded_sides),
        "max_leg_adjustment_degrees": max_adjustment,
    }


def apply_world_space_pose(
    target,
    source,
    mapped,
    scale_ratio,
    preserved_bones,
    relative_swing_bones,
    horizontal_direction_bones,
    relative_horizontal_direction_bones,
    full_rotation_bones=frozenset(),
):
    reset_target_pose(target)
    bpy.context.view_layer.update()

    source_rest_hip = bone_head_world(source, SOURCE_HIPS, False)
    source_pose_hip = bone_head_world(source, SOURCE_HIPS, True)
    hip_displacement_world = (source_pose_hip - source_rest_hip) * scale_ratio
    target_rest_hip_world = bone_head_world(target, TARGET_HIP, False)
    target_hip_armature = target.matrix_world.inverted() @ (target_rest_hip_world + hip_displacement_world)

    max_relative_swing_error_degrees = 0.0
    max_horizontal_direction_error_degrees = 0.0
    max_relative_horizontal_direction_error_degrees = 0.0
    ordered = sorted(mapped, key=lambda pair: len(target.data.bones[pair[1]].parent_recursive))
    for src_name, dst_name in ordered:
        if dst_name in preserved_bones:
            continue
        source_bone = source.pose.bones[src_name]
        target_bone = target.pose.bones[dst_name]
        if dst_name in full_rotation_bones:
            source_motion = world_pose_matrix(source, src_name).to_quaternion() @ world_rest_matrix(source, src_name).to_quaternion().inverted()
            desired_world_rotation = source_motion @ world_rest_matrix(target, dst_name).to_quaternion()
            desired_armature_rotation = target.matrix_world.to_quaternion().inverted() @ desired_world_rotation
            pose_matrix = desired_armature_rotation.to_matrix().to_4x4()
            pose_matrix.translation = target_hip_armature if dst_name == TARGET_HIP else target_bone.head.copy()
            target_bone.matrix = pose_matrix
            bpy.context.view_layer.update()
            continue
        source_direction = source.matrix_world.to_3x3() @ (source_bone.tail - source_bone.head)
        target_direction = target.matrix_world.to_3x3() @ (target_bone.tail - target_bone.head)
        source_direction.normalize()
        target_direction.normalize()
        if dst_name in relative_horizontal_direction_bones:
            horizontal_angle = source_relative_horizontal_angle(source, src_name)
            up_axis = target_parent_up_axis(target, dst_name)
            desired_target_direction = Quaternion(up_axis, horizontal_angle) @ target_direction
            desired_target_direction.normalize()
            swing = target_direction.rotation_difference(desired_target_direction)
        elif dst_name in horizontal_direction_bones:
            source_horizontal = Vector((source_direction.x, source_direction.y, 0.0))
            if source_horizontal.length <= 0.000001:
                desired_target_direction = target_direction.copy()
            else:
                source_horizontal.normalize()
                target_vertical = max(-0.999999, min(0.999999, target_direction.z))
                target_horizontal_length = math.sqrt(max(0.0, 1.0 - target_vertical * target_vertical))
                desired_target_direction = source_horizontal * target_horizontal_length
                desired_target_direction.z = target_vertical
                desired_target_direction.normalize()
            swing = target_direction.rotation_difference(desired_target_direction)
        elif dst_name in relative_swing_bones:
            motion_swing = source_relative_direction_swing(source, src_name)
            desired_target_direction = motion_swing @ target_direction
            desired_target_direction.normalize()
            swing = target_direction.rotation_difference(desired_target_direction)
        else:
            desired_target_direction = source_direction
            swing = target_direction.rotation_difference(source_direction)
        desired_world_rotation = swing @ world_pose_matrix(target, dst_name).to_quaternion()
        desired_armature_rotation = target.matrix_world.to_quaternion().inverted() @ desired_world_rotation

        pose_bone = target_bone
        pose_matrix = desired_armature_rotation.to_matrix().to_4x4()
        pose_matrix.translation = target_hip_armature if dst_name == TARGET_HIP else pose_bone.head.copy()
        pose_bone.matrix = pose_matrix
        bpy.context.view_layer.update()
        if dst_name in relative_swing_bones:
            applied_direction = target.matrix_world.to_3x3() @ (target_bone.tail - target_bone.head)
            applied_direction.normalize()
            max_relative_swing_error_degrees = max(
                max_relative_swing_error_degrees,
                math.degrees(applied_direction.angle(desired_target_direction, 0.0)),
            )
        elif dst_name in horizontal_direction_bones:
            applied_direction = target.matrix_world.to_3x3() @ (target_bone.tail - target_bone.head)
            applied_direction.normalize()
            max_horizontal_direction_error_degrees = max(
                max_horizontal_direction_error_degrees,
                math.degrees(applied_direction.angle(desired_target_direction, 0.0)),
            )
        elif dst_name in relative_horizontal_direction_bones:
            applied_direction = target.matrix_world.to_3x3() @ (target_bone.tail - target_bone.head)
            applied_direction.normalize()
            max_relative_horizontal_direction_error_degrees = max(
                max_relative_horizontal_direction_error_degrees,
                math.degrees(applied_direction.angle(desired_target_direction, 0.0)),
            )

    max_direction_error_degrees = 0.0
    for src_name, dst_name in mapped:
        if (
            dst_name in preserved_bones
            or dst_name in relative_swing_bones
            or dst_name in horizontal_direction_bones
            or dst_name in relative_horizontal_direction_bones
            or dst_name in full_rotation_bones
        ):
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
    for bone_name in preserved_bones:
        quaternion = target.pose.bones[bone_name].rotation_quaternion.normalized()
        angle = 2.0 * math.acos(max(-1.0, min(1.0, abs(quaternion.w))))
        max_preserved_bone_rotation_degrees = max(max_preserved_bone_rotation_degrees, math.degrees(angle))
    max_relative_horizontal_slope_deviation_degrees = 0.0
    for bone_name in relative_horizontal_direction_bones:
        rest_elevation = parent_local_bone_elevation_degrees(target, bone_name, False)
        pose_elevation = parent_local_bone_elevation_degrees(target, bone_name, True)
        max_relative_horizontal_slope_deviation_degrees = max(
            max_relative_horizontal_slope_deviation_degrees,
            abs(pose_elevation - rest_elevation),
        )

    source_ground = min(bone_head_world(source, name, False).z for name in SOURCE_CONTACT_BONES)
    source_min_foot = min(bone_head_world(source, name, True).z for name in SOURCE_CONTACT_BONES)
    target_ground = min(bone_head_world(target, name, False).z for name in TARGET_CONTACT_BONES)
    target_min_foot = min(bone_head_world(target, name, True).z for name in TARGET_CONTACT_BONES)
    source_clearance = source_min_foot - source_ground
    source_grounded = source_clearance <= 0.025
    target_clearance_before_correction = target_min_foot - target_ground
    desired_target_clearance = 0.0 if source_grounded else source_clearance * scale_ratio
    correction_world = desired_target_clearance - target_clearance_before_correction
    if abs(correction_world) > 0.000001:
        correction_armature = target.matrix_world.inverted().to_3x3() @ Vector((0, 0, correction_world))
        hip_matrix = target.pose.bones[TARGET_HIP].matrix.copy()
        hip_matrix.translation += correction_armature
        target.pose.bones[TARGET_HIP].matrix = hip_matrix
        bpy.context.view_layer.update()
    corrected_target_min_foot = min(bone_head_world(target, name, True).z for name in TARGET_CONTACT_BONES)
    target_clearance = corrected_target_min_foot - target_ground
    target_grounded = target_clearance <= 0.001
    return {
        "source_grounded": source_grounded,
        "target_grounded": target_grounded,
        "target_clearance": target_clearance,
        "ground_correction": correction_world,
        "max_direction_error_degrees": max_direction_error_degrees,
        "max_relative_swing_error_degrees": max_relative_swing_error_degrees,
        "max_horizontal_direction_error_degrees": max_horizontal_direction_error_degrees,
        "max_relative_horizontal_direction_error_degrees": max_relative_horizontal_direction_error_degrees,
        "max_relative_horizontal_slope_deviation_degrees": max_relative_horizontal_slope_deviation_degrees,
        "max_preserved_bone_rotation_degrees": max_preserved_bone_rotation_degrees,
    }


def bake_target_action(
    target,
    source,
    preserved_bones=PRESERVE_TARGET_ROLL_BONES,
    relative_swing_bones=frozenset(),
    horizontal_direction_bones=frozenset(),
    relative_horizontal_direction_bones=frozenset(),
    full_rotation_bones=frozenset(),
    mesh_foot_grounding=False,
):
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
    mesh = None
    foot_vertices = None
    rest_mesh_ground = 0.0
    if mesh_foot_grounding:
        mesh, foot_vertices = target_foot_surface_data(target)
        bpy.context.view_layer.update()
        rest_mesh_ground = min(mesh_sole_heights(mesh, foot_vertices).values())

    for src_name, dst_name in BONE_MAP.items():
        if dst_name in target.pose.bones and src_name in source.pose.bones:
            mapped.append((src_name, dst_name))

    action = bpy.data.actions.new("Swimming")
    target.animation_data_create()
    target.animation_data.action = action
    scale_ratio = retarget_scale(target, source)
    source_grounded_frames = 0
    target_grounded_frames = 0
    contact_mismatch_frames = []
    max_ground_correction = 0.0
    worst_grounded_penetration = 0.0
    worst_grounded_hover = 0.0
    max_direction_error_degrees = 0.0
    max_relative_swing_error_degrees = 0.0
    max_horizontal_direction_error_degrees = 0.0
    max_relative_horizontal_direction_error_degrees = 0.0
    max_relative_horizontal_slope_deviation_degrees = 0.0
    max_preserved_bone_rotation_degrees = 0.0
    max_target_root_rotation_degrees = 0.0
    max_mesh_foot_hover = 0.0
    max_foot_contact_leg_adjustment_degrees = 0.0
    continuity_bones = ["Root", *[dst_name for _src_name, dst_name in mapped]]
    previous_rotations = {}
    max_adjacent_quaternion_degrees = {bone_name: 0.0 for bone_name in continuity_bones}
    previous_source_rotations = {}
    max_source_adjacent_quaternion_degrees = {
        src_name: 0.0 for src_name, _dst_name in mapped
    }
    source_rest_hand_delta = (
        bone_head_world(source, "mixamorig:LeftHand", False).x
        - bone_head_world(source, "mixamorig:RightHand", False).x
    )
    target_rest_hand_delta = (
        bone_head_world(target, "L_Hand", False).x
        - bone_head_world(target, "R_Hand", False).x
    )
    source_hand_axis = 1.0 if source_rest_hand_delta >= 0.0 else -1.0
    target_hand_axis = 1.0 if target_rest_hand_delta >= 0.0 else -1.0
    source_crossing_frames = []
    target_crossing_frames = []
    hand_order_mismatch_frames = []
    non_finite_value_count = 0

    for frame in range(bpy.context.scene.frame_start, bpy.context.scene.frame_end + 1):
        bpy.context.scene.frame_set(frame)
        frame_metrics = apply_world_space_pose(
            target,
            source,
            mapped,
            scale_ratio,
            preserved_bones,
            relative_swing_bones,
            horizontal_direction_bones,
            relative_horizontal_direction_bones,
            full_rotation_bones,
        )
        if mesh_foot_grounding:
            mesh_metrics = apply_mesh_foot_grounding(
                target,
                source,
                mesh,
                foot_vertices,
                rest_mesh_ground,
            )
            max_mesh_foot_hover = max(max_mesh_foot_hover, mesh_metrics["max_hover"])
            max_foot_contact_leg_adjustment_degrees = max(
                max_foot_contact_leg_adjustment_degrees,
                mesh_metrics["max_leg_adjustment_degrees"],
            )
        source_grounded = frame_metrics["source_grounded"]
        target_grounded = frame_metrics["target_grounded"]
        source_grounded_frames += 1 if source_grounded else 0
        target_grounded_frames += 1 if target_grounded else 0
        if source_grounded != target_grounded:
            contact_mismatch_frames.append(frame)
        max_ground_correction = max(max_ground_correction, abs(frame_metrics["ground_correction"]))
        if source_grounded:
            worst_grounded_penetration = max(worst_grounded_penetration, -frame_metrics["target_clearance"])
            worst_grounded_hover = max(worst_grounded_hover, frame_metrics["target_clearance"])
        max_direction_error_degrees = max(
            max_direction_error_degrees,
            frame_metrics["max_direction_error_degrees"],
        )
        max_relative_swing_error_degrees = max(
            max_relative_swing_error_degrees,
            frame_metrics["max_relative_swing_error_degrees"],
        )
        max_horizontal_direction_error_degrees = max(
            max_horizontal_direction_error_degrees,
            frame_metrics["max_horizontal_direction_error_degrees"],
        )
        max_relative_horizontal_direction_error_degrees = max(
            max_relative_horizontal_direction_error_degrees,
            frame_metrics["max_relative_horizontal_direction_error_degrees"],
        )
        max_relative_horizontal_slope_deviation_degrees = max(
            max_relative_horizontal_slope_deviation_degrees,
            frame_metrics["max_relative_horizontal_slope_deviation_degrees"],
        )
        max_preserved_bone_rotation_degrees = max(
            max_preserved_bone_rotation_degrees,
            frame_metrics["max_preserved_bone_rotation_degrees"],
        )
        max_target_root_rotation_degrees = max(
            max_target_root_rotation_degrees,
            quaternion_identity_degrees(target.pose.bones["Root"].rotation_quaternion),
        )

        for bone_name in continuity_bones:
            quaternion = target.pose.bones[bone_name].rotation_quaternion.copy().normalized()
            previous = previous_rotations.get(bone_name)
            if previous is not None:
                max_adjacent_quaternion_degrees[bone_name] = max(
                    max_adjacent_quaternion_degrees[bone_name],
                    quaternion_delta_degrees(previous, quaternion),
                )
            previous_rotations[bone_name] = quaternion
        for src_name, _dst_name in mapped:
            quaternion = source.pose.bones[src_name].matrix_basis.to_quaternion().normalized()
            previous = previous_source_rotations.get(src_name)
            if previous is not None:
                max_source_adjacent_quaternion_degrees[src_name] = max(
                    max_source_adjacent_quaternion_degrees[src_name],
                    quaternion_delta_degrees(previous, quaternion),
                )
            previous_source_rotations[src_name] = quaternion

        source_hand_delta = source_hand_axis * (
            bone_head_world(source, "mixamorig:LeftHand", True).x
            - bone_head_world(source, "mixamorig:RightHand", True).x
        )
        target_hand_delta = target_hand_axis * (
            bone_head_world(target, "L_Hand", True).x
            - bone_head_world(target, "R_Hand", True).x
        )
        source_order = source_hand_delta > 0.0
        target_order = target_hand_delta > 0.0
        if not source_order:
            source_crossing_frames.append(frame)
        if not target_order:
            target_crossing_frames.append(frame)
        if source_order != target_order:
            hand_order_mismatch_frames.append(frame)

        numeric_values = [
            *target.pose.bones[TARGET_HIP].location,
            *(component for bone_name in continuity_bones for component in target.pose.bones[bone_name].rotation_quaternion),
        ]
        non_finite_value_count += sum(1 for value in numeric_values if not math.isfinite(value))
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
        "mapped_bones": len(mapped),
        "animated_clavicles": not bool(PRESERVE_TARGET_ROLL_BONES & set(preserved_bones)),
        "preserved_bones": sorted(preserved_bones),
        "relative_swing_bones": sorted(relative_swing_bones),
        "horizontal_direction_bones": sorted(horizontal_direction_bones),
        "relative_horizontal_direction_bones": sorted(relative_horizontal_direction_bones),
        "full_rotation_bones": sorted(full_rotation_bones),
        "mesh_foot_grounding": mesh_foot_grounding,
        "max_mesh_foot_hover": max_mesh_foot_hover,
        "max_foot_contact_leg_adjustment_degrees": max_foot_contact_leg_adjustment_degrees,
        "missing_source_bones": [name for name in BONE_MAP if name not in source.pose.bones],
        "missing_target_bones": [name for name in BONE_MAP.values() if name not in target.pose.bones],
        "source_grounded_frames": source_grounded_frames,
        "target_grounded_frames": target_grounded_frames,
        "grounded_frames": source_grounded_frames,
        "contact_mismatch_count": len(contact_mismatch_frames),
        "contact_mismatch_ranges": compact_frame_ranges(contact_mismatch_frames),
        "max_ground_correction": max_ground_correction,
        "worst_grounded_penetration": worst_grounded_penetration,
        "worst_grounded_hover": worst_grounded_hover,
        "max_target_root_rotation_degrees": max_target_root_rotation_degrees,
        "max_adjacent_quaternion_degrees": max(max_adjacent_quaternion_degrees.values(), default=0.0),
        "max_adjacent_quaternion_degrees_by_bone": max_adjacent_quaternion_degrees,
        "max_source_adjacent_quaternion_degrees": max(
            max_source_adjacent_quaternion_degrees.values(),
            default=0.0,
        ),
        "max_source_adjacent_quaternion_degrees_by_bone": (
            max_source_adjacent_quaternion_degrees
        ),
        "max_direction_error_degrees": max_direction_error_degrees,
        "max_relative_swing_error_degrees": max_relative_swing_error_degrees,
        "max_horizontal_direction_error_degrees": max_horizontal_direction_error_degrees,
        "max_relative_horizontal_direction_error_degrees": max_relative_horizontal_direction_error_degrees,
        "max_relative_horizontal_slope_deviation_degrees": max_relative_horizontal_slope_deviation_degrees,
        "max_preserved_bone_rotation_degrees": max_preserved_bone_rotation_degrees,
        "source_crossing_count": len(source_crossing_frames),
        "source_crossing_ranges": compact_frame_ranges(source_crossing_frames),
        "target_crossing_count": len(target_crossing_frames),
        "target_crossing_ranges": compact_frame_ranges(target_crossing_frames),
        "hand_order_mismatch_count": len(hand_order_mismatch_frames),
        "hand_order_mismatch_ranges": compact_frame_ranges(hand_order_mismatch_frames),
        "non_finite_value_count": non_finite_value_count,
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


def main(
    target_glb=TARGET_GLB,
    mixamo_fbx=MIXAMO_FBX,
    output_glb=OUTPUT_GLB,
    full_rotation_bones=frozenset(),
    mesh_foot_grounding=False,
    relative_swing_bones=frozenset(),
):
    clear_scene()
    import_inputs(target_glb, mixamo_fbx)
    target, source = find_armatures()
    animate_clavicles = os.path.basename(mixamo_fbx) in ANIMATE_CLAVICLE_SOURCE_FILES
    relative_horizontal_clavicles = os.path.basename(mixamo_fbx) in RELATIVE_HORIZONTAL_CLAVICLE_SOURCE_FILES
    preserved_bones = set() if animate_clavicles or relative_horizontal_clavicles else PRESERVE_TARGET_ROLL_BONES
    relative_swing_bones = set(relative_swing_bones)
    horizontal_direction_bones = PRESERVE_TARGET_ROLL_BONES if animate_clavicles else set()
    relative_horizontal_direction_bones = PRESERVE_TARGET_ROLL_BONES if relative_horizontal_clavicles else set()
    mapped, diagnostics = bake_target_action(
        target,
        source,
        preserved_bones,
        relative_swing_bones,
        horizontal_direction_bones,
        relative_horizontal_direction_bones,
        full_rotation_bones,
        mesh_foot_grounding,
    )
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
