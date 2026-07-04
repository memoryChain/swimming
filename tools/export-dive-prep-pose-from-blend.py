import json
import os
import sys

import bpy


PROJECT_ROOT = r"F:\myworkspace\cocosProjects\SpeedSwimming"
INPUT_BLEND = os.path.join(PROJECT_ROOT, "tools", "UserSwimmer0621_2DivePrepPose.blend")
OUTPUT_TS = os.path.join(PROJECT_ROOT, "assets", "scripts", "character", "DivePrepPoseCurve.ts")
MIRROR_LEFT_TO_RIGHT_BEFORE_EXPORT = False
SAVE_BLEND_AFTER_MIRROR = True
FREEZE_BLEND_POSE_AFTER_MIRROR = True
FOOT_PLANE_TOLERANCE = 0.001

SAMPLED_BONES = [
    "Root",
    "Hip",
    "Waist",
    "Spine01",
    "Spine02",
    "NeckTwist01",
    "Head",
    "L_Clavicle",
    "L_Upperarm",
    "L_Forearm",
    "L_Hand",
    "R_Clavicle",
    "R_Upperarm",
    "R_Forearm",
    "R_Hand",
    "L_Thigh",
    "L_Calf",
    "L_Foot",
    "L_ToeBase",
    "R_Thigh",
    "R_Calf",
    "R_Foot",
    "R_ToeBase",
]

LEFT_MIRROR_BONES = [
    "L_Clavicle",
    "L_Upperarm",
    "L_Forearm",
    "L_Hand",
    "L_Thigh",
    "L_Calf",
    "L_Foot",
    "L_ToeBase",
]


def find_armature():
    named = bpy.data.objects.get("DivePrepPose_Armature")
    if named and named.type == "ARMATURE":
        return named
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) == 1:
        return armatures[0]
    raise RuntimeError("Could not find a single dive-prep armature")


def vector_tuple(vec):
    return [round(float(vec.x), 4), round(float(vec.y), 4), round(float(vec.z), 4)]


def quat_tuple(quat):
    return [
        round(float(quat.x), 6),
        round(float(quat.y), 6),
        round(float(quat.z), 6),
        round(float(quat.w), 6),
    ]


def mirrored_x(vec):
    return type(vec)((-vec.x, vec.y, vec.z))


def should_mirror_left_to_right():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return "--mirror-left-to-right" in argv or MIRROR_LEFT_TO_RIGHT_BEFORE_EXPORT


def mirror_left_to_right(armature):
    missing = [name for name in LEFT_MIRROR_BONES if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"Missing left bones for mirrored export: {missing}")

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")

    for pose_bone in armature.pose.bones:
        pose_bone.select = False
    for name in LEFT_MIRROR_BONES:
        pose_bone = armature.pose.bones[name]
        pose_bone.select = True
        armature.data.bones.active = pose_bone.bone

    bpy.ops.pose.copy()
    bpy.ops.pose.paste(flipped=True, selected_mask=False)

    for pose_bone in armature.pose.bones:
        pose_bone.select = False
    bpy.context.view_layer.update()


def main():
    if os.path.abspath(bpy.data.filepath or "") != os.path.abspath(INPUT_BLEND):
        bpy.ops.wm.open_mainfile(filepath=INPUT_BLEND)
    armature = find_armature()
    mirror_left_to_right_enabled = should_mirror_left_to_right()
    if mirror_left_to_right_enabled:
        mirror_left_to_right(armature)
    bpy.context.view_layer.update()

    def pose_bone(name):
        bone = armature.pose.bones.get(name)
        if not bone:
            raise RuntimeError(f"Missing pose bone {name}")
        bone.rotation_mode = "QUATERNION"
        return bone

    def bone_world(name):
        return armature.matrix_world @ pose_bone(name).head

    left_foot = bone_world("L_Foot")
    right_foot = bone_world("R_Foot")
    left_toe = bone_world("L_ToeBase")
    right_toe = bone_world("R_ToeBase")
    foot_height_delta = left_foot.z - right_foot.z
    toe_height_delta = left_toe.z - right_toe.z
    if max(abs(foot_height_delta), abs(toe_height_delta)) > FOOT_PLANE_TOLERANCE:
        print(
            "Dive-prep feet are not on the same height plane: "
            f"footHeightDelta={foot_height_delta:.6f} toeHeightDelta={toe_height_delta:.6f}"
        )
    if mirror_left_to_right_enabled and FREEZE_BLEND_POSE_AFTER_MIRROR and armature.animation_data:
        armature.animation_data_clear()
    if mirror_left_to_right_enabled and SAVE_BLEND_AFTER_MIRROR:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)

    hip = bone_world("Hip")
    root = bone_world("Root")
    frame = int(bpy.context.scene.frame_current)
    sample = {
        "source": "UserSwimmer0621_2DivePrepPose.blend",
        "frameStart": frame,
        "frameEnd": frame,
        "sampleFrame": frame,
        "root": vector_tuple(root),
        "head": vector_tuple(bone_world("Head") - hip),
        "leftHand": vector_tuple(bone_world("L_Hand") - hip),
        "rightHand": vector_tuple(bone_world("R_Hand") - hip),
        "leftFoot": vector_tuple(bone_world("L_Foot") - hip),
        "rightFoot": vector_tuple(bone_world("R_Foot") - hip),
        "rotations": {},
    }

    for bone_name in SAMPLED_BONES:
        if bone_name in armature.pose.bones:
            sample["rotations"][bone_name] = quat_tuple(pose_bone(bone_name).rotation_quaternion)

    content = [
        "export type DivePrepBoneName =",
        *[f"    | '{bone_name}'" for bone_name in SAMPLED_BONES],
        ";",
        "",
        "export type DivePrepPoseSample = {",
        "    source: string;",
        "    frameStart: number;",
        "    frameEnd: number;",
        "    sampleFrame: number;",
        "    root: readonly [number, number, number];",
        "    head: readonly [number, number, number];",
        "    leftHand: readonly [number, number, number];",
        "    rightHand: readonly [number, number, number];",
        "    leftFoot: readonly [number, number, number];",
        "    rightFoot: readonly [number, number, number];",
        "    rotations: Readonly<Partial<Record<DivePrepBoneName, readonly [number, number, number, number]>>>;",
        "};",
        "",
        "// Generated by tools/export-dive-prep-pose-from-blend.py from tools/UserSwimmer0621_2DivePrepPose.blend.",
        f"export const DIVE_PREP_POSE_SAMPLE: DivePrepPoseSample = {json.dumps(sample, indent=4)} as const;",
        "",
    ]
    with open(OUTPUT_TS, "w", encoding="utf-8", newline="\n") as file:
        file.write("\n".join(content))

    print(json.dumps({
        "armature": armature.name,
        "output": OUTPUT_TS,
        "sample_frame": frame,
        "bone_count": len(sample["rotations"]),
    }, indent=2))


if __name__ == "__main__":
    main()
