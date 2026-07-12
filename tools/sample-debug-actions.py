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
SOURCE_FPS = 30

ACTION_DEFINITIONS = [
    ("waving", "Waving", "Waving.fbx"),
]

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


def write_typescript(actions):
    content = [
        "export type SampledActionBoneName =",
        *[f"    | '{bone_name}'" for bone_name in SAMPLED_BONES],
        ";",
        "",
        "export type SampledActionId = " + " | ".join(f"'{item[0]}'" for item in ACTION_DEFINITIONS) + ";",
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
        "// Generated by tools/sample-debug-actions.py. Source asymmetry is preserved.",
        f"export const SAMPLED_DEBUG_ACTIONS: readonly SampledActionMotion[] = {json.dumps(actions, separators=(',', ':'))} as const;",
        "",
        "export function findSampledDebugAction(id: SampledActionId): SampledActionMotion | null {",
        "    return SAMPLED_DEBUG_ACTIONS.find((action) => action.id === id) ?? null;",
        "}",
        "",
    ]
    with open(OUTPUT_TS, "w", encoding="utf-8", newline="\n") as file:
        file.write("\n".join(content))


def main():
    os.makedirs(RETARGETED_DIR, exist_ok=True)
    retarget = load_retarget_module()
    actions = []
    results = []
    for action_id, label, source_file in ACTION_DEFINITIONS:
        source_fbx = os.path.join(RAW_DIR, source_file)
        output_glb = os.path.join(RETARGETED_DIR, f"{action_id}.glb")
        result = retarget.main(TARGET_GLB, source_fbx, output_glb)
        if result["mapped_bones"] != len(retarget.BONE_MAP):
            raise RuntimeError(f"incomplete bone mapping for {source_file}: {result['mapped_bones']}")
        action = extract_exported_action(action_id, label, source_file, output_glb, result["diagnostics"])
        actions.append(action)
        results.append({
            "id": action_id,
            "source": source_file,
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
