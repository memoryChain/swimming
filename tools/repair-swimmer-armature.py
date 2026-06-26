import bpy
import argparse
import os
import sys
from math import radians
from mathutils import Matrix, Vector


ARM_BONE_PAIRS = (
    ('L_Clavicle', 'R_Clavicle'),
    ('L_Upperarm', 'R_Upperarm'),
    ('L_Forearm', 'R_Forearm'),
    ('L_Hand', 'R_Hand'),
)

REQUIRED_SWIM_BONES = (
    'Hip', 'Spine01', 'Spine02', 'Head',
    'L_Clavicle', 'L_Upperarm', 'L_Forearm', 'L_Hand',
    'R_Clavicle', 'R_Upperarm', 'R_Forearm', 'R_Hand',
    'L_Thigh', 'L_Calf', 'L_Foot', 'L_ToeBase',
    'R_Thigh', 'R_Calf', 'R_Foot', 'R_ToeBase',
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


def asset_objects(armature: bpy.types.Object) -> list[bpy.types.Object]:
    return [armature, *armature.children_recursive]


def normalize_asset(
    armature: bpy.types.Object,
    rotate_y_degrees: float,
    rotate_z_degrees: float,
    normalize_origin: bool,
) -> None:
    meshes = [obj for obj in asset_objects(armature) if obj.type == 'MESH']
    if not meshes:
        raise RuntimeError('armature has no skinned mesh descendants')

    rotation = (
        Matrix.Rotation(radians(rotate_z_degrees), 4, 'Z')
        @ Matrix.Rotation(radians(rotate_y_degrees), 4, 'Y')
    )
    armature.data.transform(rotation)
    for mesh in meshes:
        mesh.data.transform(rotation)

    if normalize_origin:
        vertices = [vertex.co for mesh in meshes for vertex in mesh.data.vertices]
        min_x = min(vertex.x for vertex in vertices)
        max_x = max(vertex.x for vertex in vertices)
        min_y = min(vertex.y for vertex in vertices)
        max_y = max(vertex.y for vertex in vertices)
        min_z = min(vertex.z for vertex in vertices)
        offset = Vector((-(min_x + max_x) * 0.5, -(min_y + max_y) * 0.5, -min_z))
        translation = Matrix.Translation(offset)
        armature.data.transform(translation)
        for mesh in meshes:
            mesh.data.transform(translation)

    bpy.context.view_layer.update()
    validate_asset(armature)


def validate_asset(armature: bpy.types.Object, tolerance: float = 1e-5) -> None:
    missing = [name for name in REQUIRED_SWIM_BONES if not armature.data.bones.get(name)]
    if missing:
        raise RuntimeError(f'missing required swim bones: {missing}')

    meshes = [obj for obj in asset_objects(armature) if obj.type == 'MESH']
    vertices = [vertex.co for mesh in meshes for vertex in mesh.data.vertices]
    min_x = min(vertex.x for vertex in vertices)
    max_x = max(vertex.x for vertex in vertices)
    min_y = min(vertex.y for vertex in vertices)
    max_y = max(vertex.y for vertex in vertices)
    min_z = min(vertex.z for vertex in vertices)
    max_z = max(vertex.z for vertex in vertices)
    center_x = (min_x + max_x) * 0.5
    center_y = (min_y + max_y) * 0.5
    if max(abs(center_x), abs(center_y), abs(min_z)) > tolerance:
        raise RuntimeError(
            f'origin normalization failed: center_x={center_x:.8f} '
            f'center_y={center_y:.8f} min_z={min_z:.8f}'
        )
    print(
        f'asset bounds x={min_x:.6f}..{max_x:.6f} '
        f'y={min_y:.6f}..{max_y:.6f} z={min_z:.6f}..{max_z:.6f}'
    )


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
    validate_arm_chain_lengths(armature)


def validate_arm_chain_lengths(armature: bpy.types.Object) -> None:
    for prefix in ('L_', 'R_'):
        upper = armature.data.bones[f'{prefix}Upperarm']
        forearm = armature.data.bones[f'{prefix}Forearm']
        hand = armature.data.bones[f'{prefix}Hand']
        if upper.length < 0.08 or upper.length < forearm.length * 0.72:
            raise RuntimeError(
                f'{prefix}Upperarm length looks broken: '
                f'upper={upper.length:.6f} forearm={forearm.length:.6f}. '
                'Use the original source GLB, not an already processed runtime GLB.'
            )
        if forearm.length < 0.08 or hand.length < 0.08:
            raise RuntimeError(
                f'{prefix}arm chain length looks broken: '
                f'forearm={forearm.length:.6f} hand={hand.length:.6f}'
            )


def export_runtime_glb(filepath: str, armature: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action='DESELECT')
    for obj in asset_objects(armature):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
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
    parser.add_argument('--rotate-y-degrees', type=float, default=0)
    parser.add_argument('--rotate-z-degrees', type=float, default=0)
    parser.add_argument('--normalize-origin', action='store_true')
    parser.add_argument('--mesh-name')
    parser.add_argument('--base-color-texture')
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
    armature = armatures[0]
    if args.rotate_y_degrees or args.rotate_z_degrees or args.normalize_origin:
        normalize_asset(
            armature,
            args.rotate_y_degrees,
            args.rotate_z_degrees,
            args.normalize_origin,
        )
    repair_armature_symmetry(armature)

    meshes = [obj for obj in asset_objects(armature) if obj.type == 'MESH']
    if args.mesh_name:
        if len(meshes) != 1:
            raise RuntimeError(f'expected one skinned mesh, found {len(meshes)}')
        meshes[0].name = args.mesh_name
        meshes[0].data.name = f'{args.mesh_name}Mesh'
        for material in meshes[0].data.materials:
            if not material:
                continue
            material.name = f'{args.mesh_name}Material'
            if material.use_nodes:
                image_nodes = [node for node in material.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image]
                for image_node in image_nodes:
                    image_node.image.name = f'{args.mesh_name}BaseColor'

    if args.base_color_texture:
        replacement = bpy.data.images.load(os.path.abspath(args.base_color_texture), check_existing=False)
        original_image_name = next(
            (
                node.image.name
                for mesh in meshes
                for material in mesh.data.materials
                if material and material.use_nodes
                for node in material.node_tree.nodes
                if node.type == 'TEX_IMAGE' and node.image
            ),
            None,
        )
        replacement.name = original_image_name or f'{args.mesh_name or "Swimmer"}BaseColor'
        replaced = 0
        for mesh in meshes:
            for material in mesh.data.materials:
                if not material or not material.use_nodes:
                    continue
                for node in material.node_tree.nodes:
                    if node.type == 'TEX_IMAGE' and node.image:
                        node.image = replacement
                        replaced += 1
        if replaced == 0:
            raise RuntimeError('no base-color texture nodes found')
        print(f'base color texture replaced nodes={replaced} path={replacement.filepath}')

    if args.save_blend:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
    export_runtime_glb(os.path.abspath(args.output_glb), armature)


if __name__ == '__main__':
    main()
