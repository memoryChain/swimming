import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "assets/resources/models/FreestyleCartoonAthleteV2.glb"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=str(GLB))

armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
bpy.context.view_layer.objects.active = armature

print("ACTION", armature.animation_data.action.name if armature.animation_data and armature.animation_data.action else "-")

def world_pos(bone_name):
    bone = armature.pose.bones[bone_name]
    return armature.matrix_world @ bone.tail

for frame in [1, 8, 16, 24, 32, 40, 48]:
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    print("FRAME", frame)
    for name in ["LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"]:
        p = world_pos(name)
        rot = armature.pose.bones[name].rotation_euler
        print(name, tuple(round(v, 3) for v in p), "rot", tuple(round(v, 3) for v in rot))
