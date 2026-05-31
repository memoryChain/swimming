import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "assets/resources/models/FreestyleCartoonAthleteV2.glb"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=str(GLB))

print("OBJECTS")
for obj in bpy.context.scene.objects:
    print(obj.type, obj.name, "loc", tuple(round(v, 3) for v in obj.location), "rot", tuple(round(v, 3) for v in obj.rotation_euler), "dims", tuple(round(v, 3) for v in obj.dimensions))
    if obj.type == "ARMATURE":
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="POSE")
        for name in ["Hips", "Head", "LeftArm", "RightArm", "LeftHand", "RightHand", "LeftFoot", "RightFoot"]:
            bone = obj.pose.bones.get(name)
            if bone:
                head = obj.matrix_world @ bone.head
                tail = obj.matrix_world @ bone.tail
                print("BONE", name, "head", tuple(round(v, 3) for v in head), "tail", tuple(round(v, 3) for v in tail))
        bpy.ops.object.mode_set(mode="OBJECT")
