import argparse
import json
import os
import sys

import bpy
from mathutils import Vector


BONE_PAIRS = (
    ('L_Clavicle', 'R_Clavicle'),
    ('L_Upperarm', 'R_Upperarm'),
    ('L_Forearm', 'R_Forearm'),
    ('L_Hand', 'R_Hand'),
    ('L_Thigh', 'R_Thigh'),
    ('L_Calf', 'R_Calf'),
    ('L_Foot', 'R_Foot'),
    ('L_ToeBase', 'R_ToeBase'),
)


def mirrored_x(value: Vector) -> Vector:
    return Vector((-value.x, value.y, value.z))


def load_asset(path: str) -> None:
    if path.lower().endswith('.blend'):
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)


def find_armature() -> bpy.types.Object:
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(armatures) != 1:
        raise RuntimeError(f'expected one armature, found {len(armatures)}')
    return armatures[0]


def bone_world(armature: bpy.types.Object, name: str, endpoint: str) -> Vector:
    bone = armature.pose.bones.get(name)
    if not bone:
        raise RuntimeError(f'missing pose bone {name}')
    local = bone.head if endpoint == 'head' else bone.tail
    return armature.matrix_world @ local


def audit(path: str) -> dict:
    load_asset(path)
    armature = find_armature()
    bpy.context.view_layer.update()

    pairs = {}
    max_rest_error = 0.0
    max_pose_error = 0.0
    for left_name, right_name in BONE_PAIRS:
        left = armature.data.bones[left_name]
        right = armature.data.bones[right_name]
        rest_head_error = (left.head_local - mirrored_x(right.head_local)).length
        rest_tail_error = (left.tail_local - mirrored_x(right.tail_local)).length
        rest_length_error = abs(left.length - right.length)
        left_pose_head = bone_world(armature, left_name, 'head')
        right_pose_head = bone_world(armature, right_name, 'head')
        left_pose_tail = bone_world(armature, left_name, 'tail')
        right_pose_tail = bone_world(armature, right_name, 'tail')
        pose_head_error = (left_pose_head - mirrored_x(right_pose_head)).length
        pose_tail_error = (left_pose_tail - mirrored_x(right_pose_tail)).length
        max_rest_error = max(max_rest_error, rest_head_error, rest_tail_error, rest_length_error)
        max_pose_error = max(max_pose_error, pose_head_error, pose_tail_error)
        pairs[f'{left_name}/{right_name}'] = {
            'restHeadError': round(rest_head_error, 8),
            'restTailError': round(rest_tail_error, 8),
            'restLengthError': round(rest_length_error, 8),
            'poseHeadError': round(pose_head_error, 8),
            'poseTailError': round(pose_tail_error, 8),
        }

    left_foot = bone_world(armature, 'L_Foot', 'head')
    right_foot = bone_world(armature, 'R_Foot', 'head')
    return {
        'path': path,
        'armature': armature.name,
        'maxRestError': round(max_rest_error, 8),
        'maxPoseError': round(max_pose_error, 8),
        'footHeadZDelta': round(left_foot.z - right_foot.z, 8),
        'footHeadYDelta': round(left_foot.y - right_foot.y, 8),
        'pairs': pairs,
    }


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('paths', nargs='+')
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    results = [audit(os.path.abspath(path)) for path in args.paths]
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
