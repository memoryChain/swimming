import bpy
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def script_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    source = Path(args[0]).resolve() if args else PROJECT_ROOT / "assets" / "race" / "models" / "SharkModel.glb"
    report = Path(args[1]).resolve() if len(args) > 1 else PROJECT_ROOT / "temp" / "shark-model-audit.json"
    return source, report


SOURCE_GLB, REPORT_PATH = script_args()


def rounded(values):
    return [round(float(value), 6) for value in values]


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE_GLB))

report = {
    "source": str(SOURCE_GLB.relative_to(PROJECT_ROOT)),
    "objects": [],
    "armatures": [],
    "actions": [],
}

for obj in bpy.data.objects:
    entry = {
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "location": rounded(obj.location),
        "rotation_mode": obj.rotation_mode,
        "scale": rounded(obj.scale),
    }
    if obj.type == "MESH":
        mesh = obj.data
        entry.update({
            "vertices": len(mesh.vertices),
            "polygons": len(mesh.polygons),
            "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
            "vertex_groups": [group.name for group in obj.vertex_groups],
            "shape_keys": [key.name for key in mesh.shape_keys.key_blocks] if mesh.shape_keys else [],
            "bounds_min": rounded([min(corner[i] for corner in obj.bound_box) for i in range(3)]),
            "bounds_max": rounded([max(corner[i] for corner in obj.bound_box) for i in range(3)]),
        })
    report["objects"].append(entry)

for obj in bpy.data.objects:
    if obj.type != "ARMATURE":
        continue
    armature = {
        "object": obj.name,
        "data": obj.data.name,
        "bones": [],
        "active_action": obj.animation_data.action.name if obj.animation_data and obj.animation_data.action else None,
        "nla_tracks": [],
    }
    if obj.animation_data:
        for track in obj.animation_data.nla_tracks:
            armature["nla_tracks"].append({
                "name": track.name,
                "strips": [strip.action.name if strip.action else None for strip in track.strips],
            })
    for bone in obj.data.bones:
        armature["bones"].append({
            "name": bone.name,
            "parent": bone.parent.name if bone.parent else None,
            "head": rounded(bone.head_local),
            "tail": rounded(bone.tail_local),
            "use_deform": bone.use_deform,
        })
    report["armatures"].append(armature)

for action in bpy.data.actions:
    report["actions"].append({
        "name": action.name,
        "frame_range": rounded(action.frame_range),
        "slots": [slot.identifier for slot in getattr(action, "slots", [])],
    })

REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("SHARK_AUDIT=" + str(REPORT_PATH))
