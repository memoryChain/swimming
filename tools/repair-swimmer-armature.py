import bpy
import argparse
import os
import sys
from mathutils import Vector


ARM_BONE_PAIRS = (
    ('L_Clavicle', 'R_Clavicle'),
    ('L_Upperarm', 'R_Upperarm'),
    ('L_Forearm', 'R_Forearm'),
    ('L_Hand', 'R_Hand'),
)


def mirrored_x(value: Vector) -> Vector:
    return Vector((-value.x, value.y, value.z))


def mirrored_average(left: Vector, right: Vector) -> tuple[Vector, Vector]:
    averaged_left = (left + mirrored_x(right)) * 0.5
    return averaged_left, mirrored_x(averaged_left)


def repair_armature_symmetry(armature: bpy.types.Object) -> None:
    if armature.type != 'ARMATURE':
        raise ValueError(f'{armature.name} is not an armature')

    roll_guides: dict[str, Vector] = {}
    for left_name, right_name in ARM_BONE_PAIRS:
        left = armature.data.bones.get(left_name)
        right = armature.data.bones.get(right_name)
        if not left or not right:
            raise ValueError(f'missing arm bones {left_name}/{right_name}')
        left_z = left.matrix_local.to_3x3().col[2].normalized()
        mirrored_right_z = mirrored_x(right.matrix_local.to_3x3().col[2]).normalized()
        guide = left_z + mirrored_right_z
        roll_guides[left_name] = (guide if guide.length_squared > 1e-8 else left_z).normalized()

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    edit_bones = armature.data.edit_bones

    for left_name, right_name in ARM_BONE_PAIRS:
        left = edit_bones[left_name]
        right = edit_bones[right_name]
        left_head, right_head = mirrored_average(left.head, right.head)
        left_tail, right_tail = mirrored_average(left.tail, right.tail)
        left.head = left_head
        right.head = right_head
        left.tail = left_tail
        right.tail = right_tail

    for prefix in ('L_', 'R_'):
        edit_bones[f'{prefix}Upperarm'].head = edit_bones[f'{prefix}Clavicle'].tail
        edit_bones[f'{prefix}Forearm'].head = edit_bones[f'{prefix}Upperarm'].tail
        edit_bones[f'{prefix}Hand'].head = edit_bones[f'{prefix}Forearm'].tail

    for left_name, right_name in ARM_BONE_PAIRS:
        guide = roll_guides[left_name]
        edit_bones[left_name].align_roll(guide)
        edit_bones[right_name].align_roll(mirrored_x(guide))

    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    validate_armature_symmetry(armature)


def validate_armature_symmetry(armature: bpy.types.Object, tolerance: float = 1e-5) -> None:
    for left_name, right_name in ARM_BONE_PAIRS:
        left = armature.data.bones[left_name]
        right = armature.data.bones[right_name]
        head_error = (left.head_local - mirrored_x(right.head_local)).length
        tail_error = (left.tail_local - mirrored_x(right.tail_local)).length
        length_error = abs(left.length - right.length)
        if max(head_error, tail_error, length_error) > tolerance:
            raise RuntimeError(
                f'{left_name}/{right_name} symmetry failed: '
                f'head={head_error:.8f} tail={tail_error:.8f} length={length_error:.8f}'
            )
        print(
            f'{left_name}/{right_name}: length={left.length:.6f} '
            f'head_error={head_error:.8f} tail_error={tail_error:.8f}'
        )


def export_runtime_glb(filepath: str) -> None:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_materials='EXPORT',
        export_yup=True,
    )


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output-glb', required=True)
    parser.add_argument('--save-blend')
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    input_path = os.path.abspath(args.input)
    if input_path.lower().endswith('.blend'):
        bpy.ops.wm.open_mainfile(filepath=input_path)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=input_path)

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(armatures) != 1:
        raise RuntimeError(f'expected one armature, found {len(armatures)}')
    repair_armature_symmetry(armatures[0])

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
    export_runtime_glb(os.path.abspath(args.output_glb))


if __name__ == '__main__':
    main()
