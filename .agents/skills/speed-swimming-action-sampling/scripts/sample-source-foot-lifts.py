"""补充源动作足部离地高度及静止姿态相对转动；保留既有重定向曲线和起跳台标记。"""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Quaternion, Vector

ROOT = Path(__file__).resolve().parents[4]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    reports = []
    pending = []
    for path in sorted((ROOT / 'assets/race/model-actions/tPose').glob('*.json')):
        original = path.read_text(encoding='utf-8')
        action = json.loads(original)
        if action['id'] in ('breaststroke', 'divePrep'):
            continue
        source = ROOT / 'tools/mixamo_raw' / action['sourceFile'].split(' -> ')[0]
        if not source.is_file():
            raise RuntimeError(f'缺少原始动作：{source}')
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=str(source), automatic_bone_orientation=False)
        rigs = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action]
        if len(rigs) != 1:
            raise RuntimeError(f'{source.name} 的动作骨架数量不正确')
        rig = rigs[0]
        start, end = map(lambda v: int(round(v)), rig.animation_data.action.frame_range)
        if (start, end) != (action['frameStart'], action['frameEnd']) or len(action['samples']) != end-start+1:
            raise RuntimeError(f'{source.name} 的原始帧范围不匹配')
        def bone(suffix):
            matches = [b for b in rig.data.bones if b.name.split(':')[-1] == suffix]
            if len(matches) != 1:
                raise RuntimeError(f'{source.name} 缺少唯一骨骼 {suffix}')
            return matches[0]
        feet = [[bone(side+'Foot'), bone(side+'ToeBase')] for side in ('Left', 'Right')]
        rest = [min((rig.matrix_world @ b.head_local).z for b in pair) for pair in feet]
        hip = bone('Hips')
        scale = (rig.matrix_world.to_3x3() @ hip.head_local).length
        if scale < .01:
            raise RuntimeError(f'{source.name} 的髋部基准尺度无效')
        values = []
        orientations = []
        # Blender 世界 Z 向上转换为模型 Y 向上；只传递相对源静止姿态的转动，
        # 不能把源足骨固有朝向或重定向后的骨骼方向当成目标鞋底的倾角。
        basis = Quaternion((1, 0, 0), -math.pi / 2)
        foot_bones = [b for pair in feet for b in pair]
        rest_rotations = [(rig.matrix_world @ b.matrix_local).to_quaternion() for b in foot_bones]
        max_tilt = 0.0
        max_step = 0.0
        max_basis_error = 0.0
        for frame in range(start, end+1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            lift = [round(max(0, min((rig.matrix_world @ rig.pose.bones[b.name].head).z for b in pair)-rest[side])/scale, 6)
                    for side, pair in enumerate(feet)]
            if not all(math.isfinite(v) for v in lift):
                raise RuntimeError(f'{source.name} 第 {frame} 帧出现无效离地高度')
            values.append(lift)
            frame_rotations = []
            for index, b in enumerate(foot_bones):
                posed = (rig.matrix_world @ rig.pose.bones[b.name].matrix).to_quaternion()
                motion = posed @ rest_rotations[index].inverted()
                delta = (basis @ motion @ basis.inverted()).normalized()
                if orientations:
                    previous = orientations[-1][index]
                    previous_q = Quaternion((previous[3], *previous[:3]))
                    if delta.dot(previous_q) < 0:
                        delta.negate()
                    max_step = max(max_step, delta.rotation_difference(previous_q).angle)
                # 用三个世界轴独立检查换基后的运动，而不是只核对足骨连线。
                for axis in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):
                    max_basis_error = max(max_basis_error, ((delta @ (basis @ axis)) - basis @ (motion @ axis)).length)
                max_tilt = max(max_tilt, (motion @ Vector((0, 0, 1))).angle(Vector((0, 0, 1))))
                frame_rotations.append([round(v, 7) for v in (delta.x, delta.y, delta.z, delta.w)])
            orientations.append(frame_rotations)
        if max_basis_error > 1e-5 or not all(math.isfinite(v) for f in orientations for q in f for v in q):
            raise RuntimeError(f'{source.name} 的足部换基验证失败')
        # 只增加源足部语义；既有旋转、髋位移及斜面展示的接触标记必须逐值保留。
        for sample, lift, rotations in zip(action['samples'], values, orientations):
            sample['footLiftHeights'] = lift
            sample['footOrientationDeltas'] = rotations
        action['footLiftSpace'] = 'source-rest-plane-hip-normalized-v1'
        action['footOrientationSpace'] = 'source-world-rest-delta-model-y-up-v1'
        stripped = json.loads(json.dumps(action))
        stripped.pop('footLiftSpace', None)
        stripped.pop('footOrientationSpace', None)
        for sample in stripped['samples']:
            sample.pop('footLiftHeights', None)
            sample.pop('footOrientationDeltas', None)
        before = json.loads(original)
        before.pop('footLiftSpace', None)
        before.pop('footOrientationSpace', None)
        for sample in before['samples']:
            sample.pop('footLiftHeights', None)
            sample.pop('footOrientationDeltas', None)
        if stripped != before:
            raise RuntimeError('不能改动既有采样数据')
        reports.append({'action':action['id'], 'frames':len(values), 'scale':round(scale,6),
            'raisedFrames':sum(max(v)>.0001 for v in values), 'maxLift':max(map(max,values)),
            'originalMotionUnchanged':True, 'maxFootTiltDegrees':math.degrees(max_tilt),
            'maxAdjacentFootRotationDegrees':math.degrees(max_step), 'maxBasisVectorError':max_basis_error})
        pending.append((path, action, original.startswith('{\n')))
    # 所有源动作的帧数、骨架、有限值和原数据保留检查通过后才写入。
    if args.write:
        for path, action, pretty in pending:
            path.write_text(json.dumps(action, ensure_ascii=False, indent=2 if pretty else None,
                separators=None if pretty else (',', ':'))+'\n', encoding='utf-8')
    report = ROOT / '.cache/pose-review/source-foot-lifts.json'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(reports, ensure_ascii=False))


if __name__ == '__main__':
    main()
