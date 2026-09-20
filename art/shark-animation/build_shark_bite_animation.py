import bpy
import math
import sys
from mathutils import Quaternion, Vector
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_GLB = PROJECT_ROOT / "assets" / "race" / "models" / "SharkModel.glb"
SOURCE_BLEND = PROJECT_ROOT / "art" / "shark-animation" / "SharkModel_bite_source.blend"
PREVIEW_GLB = PROJECT_ROOT / "temp" / "SharkModel_bite_preview.glb"
PREVIEW_DIR = PROJECT_ROOT / "temp" / "shark-bite-preview"
RUNTIME_GLB = SOURCE_GLB
ACTION_NAME = "Shark_Bite"
JAW_BONE_NAME = "Shark_Jaw"
OUTPUT_FRAMES = 11
SOURCE_FPS = 24


def arguments():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return {"apply": "--apply" in args}


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def sample_swim(rig, action, tracks):
    scene = bpy.context.scene
    rig.animation_data.action = action
    previous_mutes = [track.mute for track in tracks]
    for track in tracks:
        track.mute = True
    sampled = []
    for output_frame in range(1, OUTPUT_FRAMES + 1):
        source_frame = 1.0 + (output_frame - 1) / (OUTPUT_FRAMES - 1) * 24.0
        whole = int(math.floor(source_frame))
        scene.frame_set(whole, subframe=source_frame - whole)
        pose = {}
        for bone in rig.pose.bones:
            location, rotation, scale = bone.matrix_basis.decompose()
            pose[bone.name] = (location.copy(), rotation.copy(), scale.copy())
        sampled.append(pose)
    for track, muted in zip(tracks, previous_mutes):
        track.mute = muted
    return sampled


def mesh_components(mesh):
    neighbours = [set() for _ in mesh.vertices]
    for polygon in mesh.polygons:
        vertices = list(polygon.vertices)
        for index, vertex in enumerate(vertices):
            other = vertices[(index + 1) % len(vertices)]
            neighbours[vertex].add(other)
            neighbours[other].add(vertex)
    remaining = set(range(len(mesh.vertices)))
    components = []
    while remaining:
        start = remaining.pop()
        stack = [start]
        component = [start]
        while stack:
            vertex = stack.pop()
            for neighbour in neighbours[vertex]:
                if neighbour not in remaining:
                    continue
                remaining.remove(neighbour)
                stack.append(neighbour)
                component.append(neighbour)
        components.append(component)
    return components


def is_lower_jaw_component(mesh, component_index, indices):
    coords = [mesh.vertices[index].co for index in indices]
    min_x = min(point.x for point in coords)
    max_x = max(point.x for point in coords)
    min_y = min(point.y for point in coords)
    max_y = max(point.y for point in coords)
    min_z = min(point.z for point in coords)
    max_z = max(point.z for point in coords)
    center_z = sum(point.z for point in coords) / len(coords)
    within_mouth_width = max(abs(min_x), abs(max_x)) <= 0.15
    if component_index in {106, 107, 108}:
        return False
    in_front_of_hinge = min_y < -0.225 and max_y <= -0.15
    lower_shell = max_z <= 0.16 and center_z <= 0.125
    lower_tooth = len(indices) <= 8 and min_z < 0.125 and center_z <= 0.145 and max_z <= 0.19
    return within_mouth_width and in_front_of_hinge and (lower_shell or lower_tooth)


def add_jaw_bone_and_weights(rig, mesh_object):
    previous_group = mesh_object.vertex_groups.get(JAW_BONE_NAME)
    if previous_group:
        jaw_group_index = previous_group.index
        previously_weighted = [
            vertex.index
            for vertex in mesh_object.data.vertices
            if any(group.group == jaw_group_index and group.weight > 0 for group in vertex.groups)
        ]
        head_group = mesh_object.vertex_groups.get("Shark_Head")
        if head_group and previously_weighted:
            head_group.add(previously_weighted, 1.0, "REPLACE")
        mesh_object.vertex_groups.remove(previous_group)

    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    old_bone = rig.data.edit_bones.get(JAW_BONE_NAME)
    if old_bone:
        rig.data.edit_bones.remove(old_bone)
    jaw = rig.data.edit_bones.new(JAW_BONE_NAME)
    jaw.head = (0.0, -0.198, 0.137)
    jaw.tail = (0.0, -0.455, 0.137)
    jaw.parent = rig.data.edit_bones.get("Shark_Head")
    jaw.use_connect = False
    jaw.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)

    components = mesh_components(mesh_object.data)
    selected_components = [
        component for component_index, component in enumerate(components)
        if is_lower_jaw_component(mesh_object.data, component_index, component)
    ]
    selected = sorted({index for component in selected_components for index in component})
    if not selected:
        raise RuntimeError("Lower-jaw selection is empty")
    deform_groups = [
        mesh_object.vertex_groups.get(bone.name)
        for bone in rig.data.bones
        if bone.use_deform and bone.name != JAW_BONE_NAME
    ]
    for group in deform_groups:
        if group:
            group.remove(selected)
    jaw_group = mesh_object.vertex_groups.new(name=JAW_BONE_NAME)
    jaw_group.add(selected, 1.0, "REPLACE")
    print(f"SHARK_JAW_COMPONENTS={len(selected_components)}")
    print(f"SHARK_JAW_VERTICES={len(selected)}")
    return selected


def build_bite_action(rig, swim_action, sampled):
    rig.animation_data.action = swim_action
    existing = bpy.data.actions.get(ACTION_NAME)
    if existing and existing != swim_action:
        bpy.data.actions.remove(existing)
    action = bpy.data.actions.new(ACTION_NAME)
    action.use_fake_user = True
    rig.animation_data.action = action

    # 先让下颌主动张开 10 度，再快速闭合到 19 度并保持五帧；头部只做小幅前压。
    head_angles = (0, -2, -3, 4, 5, 5, 4, 2, 0, 0, 0)
    jaw_angles = (0, -10, 19, 19, 19, 19, 19, 12, 7, 3, 0)
    for frame, pose in enumerate(sampled, start=1):
        for bone in rig.pose.bones:
            location, rotation, scale = pose[bone.name]
            angle = 0.0
            if bone.name == "Shark_Head":
                angle = head_angles[frame - 1]
            elif bone.name == "Shark_Body_A":
                angle = -head_angles[frame - 1] * 0.84
            elif bone.name == "Shark_Body_B":
                angle = -head_angles[frame - 1] * 0.08
            elif bone.name == JAW_BONE_NAME:
                angle = jaw_angles[frame - 1]
            bone.location = location
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = rotation @ Quaternion((1.0, 0.0, 0.0), math.radians(angle))
            bone.scale = scale
            bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
            bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)
    rig.animation_data.action = swim_action
    return action


def export_glb(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
    )


def render_preview(rig, bite_action, tracks, mesh_object, jaw_vertices):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("BitePreviewWorld")
    scene.world.color = (0.035, 0.045, 0.06)

    camera_data = bpy.data.cameras.new("BitePreviewCamera")
    camera = bpy.data.objects.new("BitePreviewCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 1.2

    key_data = bpy.data.lights.new("BitePreviewKey", type="AREA")
    key_data.energy = 900
    key_data.size = 3.0
    key = bpy.data.objects.new("BitePreviewKey", key_data)
    scene.collection.objects.link(key)
    key.location = (1.8, -1.8, 2.4)
    point_at(key, (0, -0.1, 0.23))

    fill_data = bpy.data.lights.new("BitePreviewFill", type="AREA")
    fill_data.energy = 500
    fill_data.size = 2.5
    fill = bpy.data.objects.new("BitePreviewFill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-1.4, 0.8, 1.2)
    point_at(fill, (0, -0.1, 0.23))

    rig.animation_data.action = bite_action
    previous_mutes = [track.mute for track in tracks]
    for track in tracks:
        track.mute = True
    views = {
        "front": ((0, -1.5, 0.28), (0, -0.20, 0.23)),
        "left": ((-1.5, -0.03, 0.28), (0, -0.03, 0.23)),
        "pip": ((-1.25, 0.34, 0.72), (0, -0.20, 0.16)),
    }
    for frame in (1, 2, 3, 4, 5, 7, 9, 11):
        scene.frame_set(frame)
        for view_name, (location, target) in views.items():
            camera.location = location
            point_at(camera, target)
            scene.render.filepath = str(PREVIEW_DIR / f"frame-{frame:02d}-{view_name}.png")
            bpy.ops.render.render(write_still=True)
    selection_material = bpy.data.materials.new("JawSelectionPreview")
    selection_material.use_nodes = True
    principled = selection_material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.95, 0.005, 0.002, 1.0)
    principled.inputs["Roughness"].default_value = 1.0
    mesh_object.data.materials.append(selection_material)
    selection_index = len(mesh_object.data.materials) - 1
    jaw_set = set(jaw_vertices)
    changed_polygons = []
    scene.frame_set(1)
    for polygon in mesh_object.data.polygons:
        if all(index in jaw_set for index in polygon.vertices):
            changed_polygons.append((polygon, polygon.material_index))
            polygon.material_index = selection_index
    for view_name in ("front", "left", "pip"):
        location, target = views[view_name]
        camera.location = location
        point_at(camera, target)
        scene.render.filepath = str(PREVIEW_DIR / f"jaw-selection-{view_name}.png")
        bpy.ops.render.render(write_still=True)
    for polygon, material_index in changed_polygons:
        polygon.material_index = material_index
    mesh_object.data.materials.pop(index=selection_index)
    bpy.data.materials.remove(selection_material)
    for track, muted in zip(tracks, previous_mutes):
        track.mute = muted


opts = arguments()
if SOURCE_BLEND.exists():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_GLB))
rig = bpy.data.objects["Shark_Rig"]
rig.animation_data_create()
swim_action = bpy.data.actions.get("Shark_Swim_Loop")
if swim_action is None:
    raise RuntimeError("Shark_Swim_Loop action is missing")
mesh_object = bpy.data.objects["Shark_Mesh"]
selected = add_jaw_bone_and_weights(rig, mesh_object)
tracks = list(rig.animation_data.nla_tracks)
sampled = sample_swim(rig, swim_action, tracks)
bite_action = build_bite_action(rig, swim_action, sampled)

bpy.context.scene.render.fps = SOURCE_FPS
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = OUTPUT_FRAMES
rig.animation_data.action = swim_action
SOURCE_BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_BLEND))

output_glb = RUNTIME_GLB if opts["apply"] else PREVIEW_GLB
export_glb(output_glb)
render_preview(rig, bite_action, tracks, mesh_object, selected)
print("SHARK_BITE_ACTION=" + bite_action.name)
print("SHARK_BITE_SOURCE=" + str(SOURCE_BLEND))
print("SHARK_BITE_GLB=" + str(output_glb))
print("SHARK_BITE_APPLIED=" + str(opts["apply"]))
