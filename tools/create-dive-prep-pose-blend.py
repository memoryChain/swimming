import os

import bpy


PROJECT_ROOT = r"F:\myworkspace\cocosProjects\SpeedSwimming"
SOURCE_GLB = os.path.join(PROJECT_ROOT, "assets", "resources", "models", "UserSwimmer0621_2SumoHighPull.glb")
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


def main():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=SOURCE_GLB)
    armature = find_armature()
    armature.name = "DivePrepPose_Armature"
    armature.data.name = "DivePrepPose_ArmatureData"

    action = armature.animation_data.action if armature.animation_data else None
    if not action:
        raise RuntimeError("Imported source action is missing")
    sample_frame = int(action.frame_range[1])
    bpy.context.scene.frame_start = sample_frame
    bpy.context.scene.frame_end = sample_frame
    bpy.context.scene.frame_set(sample_frame)

    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")

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
        "When done, run tools/export-dive-prep-pose-from-blend.py from Blender to update assets/scripts/character/DivePrepPoseCurve.ts.\n"
        "Useful bones: L_Clavicle/R_Clavicle, L_Upperarm/R_Upperarm, L_Forearm/R_Forearm, Hip, Waist, Spine01, Spine02, Head.\n"
    )

    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    print(f"Saved {OUTPUT_BLEND}")


if __name__ == "__main__":
    main()
