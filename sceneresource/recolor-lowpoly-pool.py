"""Recolor and export the runtime pool.

Run with Blender in background mode:
blender --background --python sceneresource/recolor-lowpoly-pool.py -- \
  --blend sceneresource/LowPolyPool.blend \
  --output-glb assets/resources/pool/LowPolyPool.glb
"""

import argparse
import os
import sys

import bpy


PALETTE = {
    'LPVenue_cartoon_aisle_light': '#D2E9F0',
    'LPVenue_cartoon_deck_cobalt': '#2078D8',
    'LPVenue_cartoon_deck_sky_panels': '#29BFEA',
    'LPVenue_cartoon_fascia_blue': '#1268DB',
    'LPVenue_cartoon_fascia_graphic_cyan': '#08BDE8',
    'LPVenue_cartoon_float_blue': '#075BE0',
    'LPVenue_cartoon_float_red': '#FF3E38',
    'LPVenue_cartoon_float_white': '#FFF4D2',
    'LPVenue_cartoon_float_yellow': '#FFD52F',
    'LPVenue_cartoon_glass_rail_light': '#8CDFF4C7',
    'LPVenue_cartoon_inner_wall_navy': '#174B91',
    'LPVenue_cartoon_lane_floor_navy': '#1454A2',
    'LPVenue_cartoon_pool_edge_white': '#FFF3CF',
    'LPVenue_cartoon_pool_tile_grout': '#8ED2E4',
    'LPVenue_cartoon_pool_tile_white': '#EAF8F5',
    'LPVenue_cartoon_riser_shadow': '#12366E',
    'LPVenue_cartoon_screen_aqua': '#24C8E8',
    'LPVenue_cartoon_screen_dark': '#174C90',
    'LPVenue_cartoon_seat_blue': '#1A78C8',
    'LPVenue_cartoon_seat_deep_blue': '#1658AD',
    'LPVenue_cartoon_start_block_cream': '#FFE6A8',
    'LPVenue_runtime_water_placeholder': '#109EEB42',
}

EXPORT_COLLECTION = 'LowPoly_Swim_Venue_Game'


def srgb(hex_color: str) -> tuple[float, float, float, float]:
    value = hex_color.removeprefix('#')
    if len(value) not in (6, 8):
        raise ValueError(f'invalid color {hex_color}')
    channels = [int(value[i:i + 2], 16) / 255 for i in range(0, len(value), 2)]
    if len(channels) == 3:
        channels.append(1.0)
    return tuple(channels)


def apply_palette() -> None:
    missing = sorted(set(PALETTE) - set(bpy.data.materials.keys()))
    if missing:
        # Rebuilt venue blends intentionally use a smaller flat-color material
        # set. Keep the legacy palette useful for LowPolyPool.blend while
        # allowing the rebuilt scene to export its existing materials unchanged.
        print(f'palette skipped missing materials={missing}')

    for name, hex_color in PALETTE.items():
        material = bpy.data.materials.get(name)
        if not material:
            continue
        color = srgb(hex_color)
        material.diffuse_color = color
        material.metallic = 0
        if name != 'LPVenue_runtime_water_placeholder':
            material.roughness = 0.82
        if material.use_nodes:
            principled = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
            if principled:
                principled.inputs['Base Color'].default_value = color
                metallic = principled.inputs.get('Metallic IOR Level') or principled.inputs.get('Metallic')
                if metallic:
                    metallic.default_value = 0
                if name != 'LPVenue_runtime_water_placeholder':
                    principled.inputs['Roughness'].default_value = 0.82
                if 'Alpha' in principled.inputs:
                    principled.inputs['Alpha'].default_value = color[3]
        print(f'palette {name}={hex_color}')


def collection_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    objects = set(collection.objects)
    for child in collection.children:
        objects.update(collection_objects(child))
    return objects


def export_runtime_glb(filepath: str) -> None:
    collection = bpy.data.collections.get(EXPORT_COLLECTION)
    if not collection:
        raise RuntimeError(f'missing export collection {EXPORT_COLLECTION}')
    objects = sorted(collection_objects(collection), key=lambda obj: obj.name)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(objects))
    print(f'export collection={EXPORT_COLLECTION} objects={len(objects)}')
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_animations=False,
        export_materials='EXPORT',
        export_yup=True,
    )


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--blend', required=True)
    parser.add_argument('--output-glb', required=True)
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    blend_path = os.path.abspath(args.blend)
    output_path = os.path.abspath(args.output_glb)
    bpy.ops.wm.open_mainfile(filepath=blend_path)
    apply_palette()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    export_runtime_glb(output_path)


if __name__ == '__main__':
    main()
