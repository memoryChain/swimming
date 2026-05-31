import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
fbx = ROOT / "assets/resources/models/KenneyCharacters/characterMedium.fbx"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.fbx(filepath=str(fbx))

print("OBJECTS")
for obj in bpy.context.scene.objects:
    print(obj.type, obj.name, "children", len(obj.children))
    if obj.type == "ARMATURE":
        print("BONES")
        for bone in obj.data.bones:
            print(bone.name, "parent", bone.parent.name if bone.parent else "-")
    if obj.type == "MESH":
        print("MATERIALS", [slot.material.name if slot.material else "-" for slot in obj.material_slots])
        print("VERTEX_GROUPS", [group.name for group in obj.vertex_groups][:80])
