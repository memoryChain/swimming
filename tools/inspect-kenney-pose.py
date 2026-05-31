import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FBX = ROOT / "assets/resources/models/KenneyCharacters/characterMedium.fbx"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.fbx(filepath=str(FBX))

armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode="POSE")

for name in [
    "Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot",
    "RightUpLeg", "RightLeg", "RightFoot",
]:
    bone = armature.pose.bones.get(name)
    if bone:
        print(name, "head", tuple(round(v, 4) for v in bone.head), "tail", tuple(round(v, 4) for v in bone.tail), "rotmode", bone.rotation_mode)

bpy.ops.object.mode_set(mode="OBJECT")
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        print("mesh", obj.name, "bbox", [tuple(round(v, 4) for v in corner) for corner in obj.bound_box[:2]], "dims", tuple(round(v, 4) for v in obj.dimensions))
