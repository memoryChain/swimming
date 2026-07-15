import importlib.util
import bisect
import json
import math
import os
import struct

import bpy


PROJECT_ROOT = r"F:\myworkspace\cocosProjects\SpeedSwimming"
TARGET_GLB = os.path.join(PROJECT_ROOT, "assets", "race", "models", "UserSwimmer0621_2.glb")
RAW_DIR = os.path.join(PROJECT_ROOT, "tools", "mixamo_raw")
RETARGETED_DIR = os.path.join(PROJECT_ROOT, "tools", "retargeted_actions")
OUTPUT_TS = os.path.join(PROJECT_ROOT, "assets", "scripts", "character", "SampledActionMotionCurve.ts")
OUTPUT_ACTION_DIR = os.path.join(PROJECT_ROOT, "assets", "race", "sampled-actions")
SOURCE_FPS = 30

ACTION_DEFINITIONS = [
    ("waving", "Waving", "Waving.fbx"),
    ("arm_stretching", "Arm Stretching", "Arm Stretching.fbx"),
    ("chicken_dance", "Chicken Dance", "Chicken Dance.fbx"),
    ("neck_stretching", "Neck Stretching", "Neck Stretching.fbx"),
    ("silly_dancing", "Silly Dancing", "Silly Dancing.fbx"),
    ("twist_dance", "Twist Dance", "Twist Dance.fbx"),
    ("waving_gesture", "Waving Gesture", "Waving Gesture.fbx"),
    ("ymca_dance", "Ymca Dance", "Ymca Dance.fbx"),
    ("dancing_twerk", "Dancing Twerk", "Dancing Twerk.fbx"),
    ("joyful_jump", "Joyful Jump", "Joyful Jump.fbx"),
    ("victory_idle", "Victory Idle", "Victory Idle.fbx"),
    ("victory", "Victory", "Victory.fbx"),
    ("angry", "Angry", "Angry.fbx"),
    ("defeated", "Defeated", "Defeated.fbx"),
    ("loser", "Loser", "Loser.fbx"),
    ("clapping", "Clapping", "Clapping.fbx"),
    ("excited", "Excited", "Excited.fbx"),
    ("happy", "Happy", "Happy.fbx"),
    ("waving_0713", "Waving 0713", "Waving 0713.fbx"),
]

# Arm Stretching deliberately crosses both arms. Its clavicles match the source
# horizontal direction while retaining the target rig's own vertical shoulder
# slope. The remaining ordering differences are crossing-boundary frames caused
# by different shoulder width and limb ratios. The Blender front silhouette and
# multi-frame side chest-clearance checks must pass before this exact exception
# is updated or retained.
EXPLAINED_HAND_ORDER_MISMATCH_COUNTS = {
    "arm_stretching": 8,
    # The source hands cross for exactly F111; the target hands only touch at
    # that instant because its shoulder width and hand spacing differ.
    "chicken_dance": 1,
    # The source hands cross from F161-F170. With the target swimmer's shoulder
    # width and limb ratios they cross from F162-F169; the two boundary frames
    # only touch. The Blender critical-frame strip confirms the same motion and
    # no left/right inversion.
    "twist_dance": 2,
    # Angry crosses its arms for F17-F236 in the source and F20-F233 on the
    # narrower target. The six boundary frames preserve the same gesture and
    # were checked from front/side/three-quarter views.
    "angry": 6,
    # The source hands barely cross at F28 while the target hands touch without
    # reversing. Adjacent F27-F29 silhouettes confirm the clap stays correct.
    "clapping": 1,
}

# Chicken Dance contains intentionally snappy wrist flicks. The worst target
# delta is 35.97 degrees at F104->F105 and the source hand direction already
# changes 30.78 degrees there; the critical-frame Blender strip shows no flip.
MAX_ADJACENT_QUATERNION_DEGREES = {
    "chicken_dance": 40.0,
    # Source world rotation changes 38.98 degrees at F15->F16. The target's
    # 34.35-degree local change follows the same raised-arm silhouette.
    "victory_idle": 35.0,
    # Source local/world hand rotation changes 34.71/38.58 degrees at
    # F542->F543; the target changes 33.90 degrees without a visible flip.
    "angry": 35.0,
    # The source right hand changes 30.22 degrees in world space at F26->F27.
    # The 36.06-degree target change preserves the same wave arc in all views.
    "waving_0713": 37.0,
}

SAMPLED_BONES = [
    "Root", "Hip", "Waist", "Spine01", "Spine02", "NeckTwist01", "Head",
    "L_Clavicle", "L_Upperarm", "L_Forearm", "L_Hand",
    "R_Clavicle", "R_Upperarm", "R_Forearm", "R_Hand",
    "L_Thigh", "L_Calf", "L_Foot", "L_ToeBase",
    "R_Thigh", "R_Calf", "R_Foot", "R_ToeBase",
]


def load_retarget_module():
    path = os.path.join(PROJECT_ROOT, "tools", "retarget-mixamo-swimming.py")
    spec = importlib.util.spec_from_file_location("speed_swimming_retarget", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def quat_tuple(quat):
    return [
        round(float(quat.x), 6),
        round(float(quat.y), 6),
        round(float(quat.z), 6),
        round(float(quat.w), 6),
    ]


def vector_tuple(vector):
    return [
        round(float(vector.x), 6),
        round(float(vector.y), 6),
        round(float(vector.z), 6),
    ]


ACCESSOR_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT4": 16,
}
COMPONENT_FORMATS = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}


def read_glb(path):
    with open(path, "rb") as file:
        magic, version, total_length = struct.unpack("<4sII", file.read(12))
        if magic != b"glTF" or version != 2:
            raise RuntimeError(f"unsupported GLB header: {path}")
        document = None
        binary = None
        while file.tell() < total_length:
            chunk_length, chunk_type = struct.unpack("<II", file.read(8))
            chunk = file.read(chunk_length)
            if chunk_type == 0x4E4F534A:
                document = json.loads(chunk.decode("utf-8").rstrip("\x00 \t\r\n"))
            elif chunk_type == 0x004E4942:
                binary = chunk
        if document is None or binary is None:
            raise RuntimeError(f"GLB is missing JSON or BIN chunk: {path}")
        return document, binary


def read_accessor(document, binary, accessor_index):
    accessor = document["accessors"][accessor_index]
    if "sparse" in accessor:
        raise RuntimeError("sparse GLB accessors are not supported by the sampler")
    view = document["bufferViews"][accessor["bufferView"]]
    component_format, component_size = COMPONENT_FORMATS[accessor["componentType"]]
    component_count = ACCESSOR_COMPONENTS[accessor["type"]]
    packed_size = component_size * component_count
    stride = view.get("byteStride", packed_size)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    unpack_format = "<" + component_format * component_count
    values = []
    for index in range(accessor["count"]):
        value = struct.unpack_from(unpack_format, binary, offset + index * stride)
        values.append(value[0] if component_count == 1 else list(value))
    return values


def normalize_quaternion(value):
    length = math.sqrt(sum(component * component for component in value))
    if length <= 0.0000001:
        raise RuntimeError("zero-length quaternion in exported GLB")
    return [component / length for component in value]


def slerp_quaternion(left, right, ratio):
    a = normalize_quaternion(left)
    b = normalize_quaternion(right)
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b = [-value for value in b]
        dot = -dot
    dot = max(-1.0, min(1.0, dot))
    if dot > 0.9995:
        return normalize_quaternion([x + (y - x) * ratio for x, y in zip(a, b)])
    theta = math.acos(dot)
    sin_theta = math.sin(theta)
    left_weight = math.sin((1.0 - ratio) * theta) / sin_theta
    right_weight = math.sin(ratio * theta) / sin_theta
    return [x * left_weight + y * right_weight for x, y in zip(a, b)]


def sample_exported_channel(times, values, sample_time, path, interpolation):
    if interpolation not in ("LINEAR", "STEP"):
        raise RuntimeError(f"unsupported GLB interpolation: {interpolation}")
    if sample_time <= times[0]:
        return values[0]
    if sample_time >= times[-1]:
        return values[-1]
    right_index = bisect.bisect_right(times, sample_time)
    left_index = right_index - 1
    if interpolation == "STEP":
        return values[left_index]
    span = times[right_index] - times[left_index]
    ratio = (sample_time - times[left_index]) / max(0.0000001, span)
    if path == "rotation":
        return slerp_quaternion(values[left_index], values[right_index], ratio)
    return [a + (b - a) * ratio for a, b in zip(values[left_index], values[right_index])]


def extract_exported_action(action_id, label, source_file, output_glb, diagnostics):
    document, binary = read_glb(output_glb)
    animations = document.get("animations", [])
    if len(animations) != 1:
        raise RuntimeError(f"expected one exported animation in {source_file}, got {len(animations)}")
    animation = animations[0]
    node_names = {index: node.get("name", "") for index, node in enumerate(document.get("nodes", []))}
    channels = {}
    channel_times = {}
    channel_interpolations = {}
    for channel in animation["channels"]:
        target = channel["target"]
        name = node_names.get(target["node"], "")
        path = target["path"]
        if name not in SAMPLED_BONES or path not in ("rotation", "translation"):
            continue
        sampler = animation["samplers"][channel["sampler"]]
        channels[(name, path)] = read_accessor(document, binary, sampler["output"])
        channel_times[(name, path)] = read_accessor(document, binary, sampler["input"])
        channel_interpolations[(name, path)] = sampler.get("interpolation", "LINEAR")

    missing_rotations = [name for name in SAMPLED_BONES if (name, "rotation") not in channels]
    if missing_rotations:
        raise RuntimeError(f"missing exported rotation channels for {source_file}: {missing_rotations}")
    if ("Hip", "translation") not in channels:
        raise RuntimeError(f"missing exported Hip translation channel for {source_file}")

    expected_count = diagnostics["sample_count"]
    for key, values in channels.items():
        times = channel_times[key]
        if not values or len(values) != len(times):
            raise RuntimeError(f"invalid channel samples for {source_file} {key}")

    duration = (expected_count - 1) / SOURCE_FPS
    exported_start = min(times[0] for times in channel_times.values())
    exported_end = max(times[-1] for times in channel_times.values())
    exported_duration = exported_end - exported_start
    if abs(exported_duration - duration) > 0.0001:
        raise RuntimeError(f"exported duration mismatch for {source_file}: {exported_duration} != {duration}")
    sample_times = [exported_start + index / SOURCE_FPS for index in range(expected_count)]
    samples = []
    for index, sample_time in enumerate(sample_times):
        phase = (sample_time - exported_start) / max(0.000001, duration)
        rotations = {
            bone_name: [round(float(component), 6) for component in normalize_quaternion(sample_exported_channel(
                channel_times[(bone_name, "rotation")],
                channels[(bone_name, "rotation")],
                sample_time,
                "rotation",
                channel_interpolations[(bone_name, "rotation")],
            ))]
            for bone_name in SAMPLED_BONES
        }
        hip_translation = sample_exported_channel(
            channel_times[("Hip", "translation")],
            channels[("Hip", "translation")],
            sample_time,
            "translation",
            channel_interpolations[("Hip", "translation")],
        )
        numeric_values = [*hip_translation, *(component for rotation in rotations.values() for component in rotation)]
        if not all(math.isfinite(value) for value in numeric_values):
            raise RuntimeError(f"non-finite exported transform in {source_file} sample {index}")
        samples.append({
            "phase": round(phase, 6),
            "hipTranslation": [round(float(value), 6) for value in hip_translation],
            "rotations": rotations,
        })

    return {
        "id": action_id,
        "label": label,
        "sourceFile": source_file,
        "durationSeconds": round(duration, 4),
        "frameStart": diagnostics["frame_start"],
        "frameEnd": diagnostics["frame_end"],
        "sampleRateHz": SOURCE_FPS,
        "samples": samples,
    }


def action_output_path(action_id):
    return os.path.join(OUTPUT_ACTION_DIR, f"{action_id}.json")


def write_text_if_changed(path, content):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as file:
            if file.read() == content:
                return False
    with open(path, "w", encoding="utf-8", newline="\n") as file:
        file.write(content)
    return True


def write_typescript(actions):
    os.makedirs(OUTPUT_ACTION_DIR, exist_ok=True)
    for action in actions:
        write_text_if_changed(
            action_output_path(action["id"]),
            json.dumps(action, separators=(',', ':')),
        )

    content = [
        "export type SampledActionBoneName =",
        *[f"    | '{bone_name}'" for bone_name in SAMPLED_BONES],
        ";",
        "",
        "export const SAMPLED_ACTION_IDS = [",
        *[f"    '{action_id}'," for action_id, _label, _source_file in ACTION_DEFINITIONS],
        "] as const;",
        "",
        "export type SampledActionId = typeof SAMPLED_ACTION_IDS[number];",
        "",
        "export type SampledActionMotionSample = {",
        "    phase: number;",
        "    hipTranslation: readonly [number, number, number];",
        "    rotations: Readonly<Partial<Record<SampledActionBoneName, readonly [number, number, number, number]>>>;",
        "};",
        "",
        "export type SampledActionMotion = {",
        "    id: SampledActionId;",
        "    label: string;",
        "    sourceFile: string;",
        "    durationSeconds: number;",
        "    frameStart: number;",
        "    frameEnd: number;",
        "    sampleRateHz: number;",
        "    samples: readonly SampledActionMotionSample[];",
        "};",
        "",
        "// The large sampled curves are race-bundle JSON assets. Keeping this module as a",
        "// small type/registry index prevents them from entering the WeChat startup script.",
        "const SAMPLED_DEBUG_ACTIONS_BY_ID: Partial<Record<SampledActionId, SampledActionMotion>> = {};",
        "",
        "export function registerSampledDebugAction(action: SampledActionMotion) {",
        "    SAMPLED_DEBUG_ACTIONS_BY_ID[action.id] = action;",
        "}",
        "",
        "export function haveAllSampledDebugActions(): boolean {",
        "    return SAMPLED_ACTION_IDS.every((id) => Boolean(SAMPLED_DEBUG_ACTIONS_BY_ID[id]));",
        "}",
        "",
        "export function getLoadedSampledDebugActions(): readonly SampledActionMotion[] {",
        "    return SAMPLED_ACTION_IDS",
        "        .map((id) => SAMPLED_DEBUG_ACTIONS_BY_ID[id])",
        "        .filter((action): action is SampledActionMotion => Boolean(action));",
        "}",
        "",
        "export function findSampledDebugAction(id: SampledActionId): SampledActionMotion | null {",
        "    return SAMPLED_DEBUG_ACTIONS_BY_ID[id] ?? null;",
        "}",
        "",
    ]
    write_text_if_changed(OUTPUT_TS, "\n".join(content))


def read_existing_actions():
    split_actions = []
    for action_id, _label, _source_file in ACTION_DEFINITIONS:
        path = action_output_path(action_id)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as file:
            split_actions.append(json.load(file))
    if split_actions:
        return split_actions

    # One-time migration fallback for the former monolithic generated file.
    if not os.path.exists(OUTPUT_TS):
        return []
    with open(OUTPUT_TS, "r", encoding="utf-8") as file:
        content = file.read()
    prefix = "export const SAMPLED_DEBUG_ACTIONS: readonly SampledActionMotion[] = "
    suffix = " as const;"
    start = content.find(prefix)
    if start < 0:
        return []
    start += len(prefix)
    end = content.find(suffix, start)
    if end < 0:
        return []
    return json.loads(content[start:end])


def validate_retarget_diagnostics(action_id, source_file, retarget, result):
    diagnostics = result["diagnostics"]
    failures = []
    if result["mapped_bones"] != len(retarget.BONE_MAP):
        failures.append(f"mapped {result['mapped_bones']} of {len(retarget.BONE_MAP)} bones")
    if diagnostics.get("missing_source_bones"):
        failures.append(f"missing source bones {diagnostics['missing_source_bones']}")
    if diagnostics.get("missing_target_bones"):
        failures.append(f"missing target bones {diagnostics['missing_target_bones']}")
    if diagnostics.get("max_target_root_rotation_degrees", 0.0) > 0.0001:
        failures.append(f"Root rotated {diagnostics['max_target_root_rotation_degrees']} degrees")
    if diagnostics.get("contact_mismatch_count", 0) != 0:
        failures.append(f"contact mismatches {diagnostics['contact_mismatch_ranges']}")
    if diagnostics.get("max_direction_error_degrees", 0.0) > 0.001:
        failures.append(f"direction error {diagnostics['max_direction_error_degrees']} degrees")
    if diagnostics.get("max_relative_swing_error_degrees", 0.0) > 0.001:
        failures.append(f"relative swing error {diagnostics['max_relative_swing_error_degrees']} degrees")
    if diagnostics.get("max_horizontal_direction_error_degrees", 0.0) > 0.001:
        failures.append(f"horizontal shoulder direction error {diagnostics['max_horizontal_direction_error_degrees']} degrees")
    if diagnostics.get("max_relative_horizontal_direction_error_degrees", 0.0) > 0.001:
        failures.append(
            "relative horizontal shoulder direction error "
            f"{diagnostics['max_relative_horizontal_direction_error_degrees']} degrees"
        )
    if diagnostics.get("max_relative_horizontal_slope_deviation_degrees", 0.0) > 0.001:
        failures.append(
            "relative shoulder slope drift "
            f"{diagnostics['max_relative_horizontal_slope_deviation_degrees']} degrees"
        )
    if diagnostics.get("max_preserved_bone_rotation_degrees", 0.0) > 0.001:
        failures.append(f"preserved shoulder rotation {diagnostics['max_preserved_bone_rotation_degrees']} degrees")
    if diagnostics.get("non_finite_value_count", 0) != 0:
        failures.append(f"non-finite values {diagnostics['non_finite_value_count']}")
    continuity_limit = MAX_ADJACENT_QUATERNION_DEGREES.get(action_id, 30.0)
    if diagnostics.get("max_adjacent_quaternion_degrees", 0.0) > continuity_limit:
        failures.append(f"unexplained adjacent rotation jump {diagnostics['max_adjacent_quaternion_degrees']} degrees")

    mismatch_count = diagnostics.get("hand_order_mismatch_count", 0)
    explained_count = EXPLAINED_HAND_ORDER_MISMATCH_COUNTS.get(action_id, 0)
    if mismatch_count != explained_count:
        failures.append(
            f"hand-order mismatch count {mismatch_count}; expected documented count {explained_count} "
            f"at {diagnostics.get('hand_order_mismatch_ranges', [])}"
        )
    if failures:
        raise RuntimeError(f"retarget validation failed for {source_file}: " + "; ".join(failures))


def main(action_ids=None):
    os.makedirs(RETARGETED_DIR, exist_ok=True)
    retarget = load_retarget_module()
    selected_ids = set(action_ids) if action_ids is not None else None
    existing_actions = {action["id"]: action for action in read_existing_actions()}
    actions = []
    results = []
    for action_id, label, source_file in ACTION_DEFINITIONS:
        if selected_ids is not None and action_id not in selected_ids:
            existing = existing_actions.get(action_id)
            if not existing:
                raise RuntimeError(f"cannot preserve missing generated action: {action_id}")
            actions.append(existing)
            results.append({
                "id": action_id,
                "source": source_file,
                "reused": True,
                "frameStart": existing["frameStart"],
                "frameEnd": existing["frameEnd"],
                "sampleCount": len(existing["samples"]),
                "durationSeconds": existing["durationSeconds"],
            })
            continue
        source_fbx = os.path.join(RAW_DIR, source_file)
        output_glb = os.path.join(RETARGETED_DIR, f"{action_id}.glb")
        result = retarget.main(TARGET_GLB, source_fbx, output_glb)
        validate_retarget_diagnostics(action_id, source_file, retarget, result)
        action = extract_exported_action(action_id, label, source_file, output_glb, result["diagnostics"])
        actions.append(action)
        results.append({
            "id": action_id,
            "source": source_file,
            "reused": False,
            "mappedBones": result["mapped_bones"],
            "frameStart": action["frameStart"],
            "frameEnd": action["frameEnd"],
            "sampleCount": len(action["samples"]),
            "durationSeconds": action["durationSeconds"],
        })

    write_typescript(actions)
    print(json.dumps({
        "output": OUTPUT_TS,
        "sampleRateHz": SOURCE_FPS,
        "actions": results,
    }, indent=2))


if __name__ == "__main__":
    main()
