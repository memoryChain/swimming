"""恢复已有炮台的原色板，仅修改 Blender 顶点色并重导底座、喷管。

python3 scripts/run-blender.py -- --python scripts/flatten-cannon-colors.py
固定明暗移除后，运行时须直接消费线性 COLOR_0，不再做 sRGB 转换。
"""
import importlib.util
import json
import shutil
import tempfile
from collections import Counter
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'modelresource/entertainment/Cannon.blend'
REFERENCE = SOURCE.with_name('Cannon-reference.json')
NAMES = ('CannonBase', 'CannonNozzle')
REVISION = 'flat-palette-linear-v1'
# 来源 build_obstacles.py 的屏幕 sRGB 色板；原 BYTE_COLOR 写入会量化到 8 位。
SRGB = {'blue': (.04, .38, .82), 'white': (.9, .97, 1),
        'orange': (1, .38, .035), 'mouth': (.035, .18, .32)}
OLD_OUTLINE = tuple((v / 255) ** 2 for v in (12, 24, 32)) + (1,)


def linear(v):
    v = round(v * 255) / 255
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


PALETTE = {name: tuple(linear(v) for v in color) + (1,) for name, color in SRGB.items()}
# 旧 builtin-unlit 将描边数值再平方；提前转换一次，保留同样的显示明度。
PALETTE['outline'] = tuple(v * v for v in OLD_OUTLINE[:3]) + (1,)


def identify(color):
    assert abs(color[3] - 1) < 1e-6, '炮台应保持不透明'
    if max(abs(a - b) for a, b in zip(color, OLD_OUTLINE)) < 1e-6:
        return 'outline'
    # 方向性明暗等比例缩放 RGB；归一化后恢复色板身份。
    # BYTE_COLOR 重新量化有误差，但四种原色之间仍有明确间隔。
    normalized = [v / max(color[:3]) for v in color[:3]]
    fits = sorted((max(abs(normalized[i] - base[i] / max(base[:3])) for i in range(3)), name)
                  for name, base in PALETTE.items() if name != 'outline')
    assert fits[0][0] < .012 and fits[1][0] - fits[0][0] > .1, ('不能确定原色', color, fits)
    return fits[0][1]


def main():
    reference = json.loads(REFERENCE.read_text(encoding='utf-8'))
    if reference.get('colorRevision', {}).get('id') == REVISION:
        print('炮台已恢复纯色；后续手工编辑请使用正常 Blender 导出入口。')
        return
    # 全部分类与范围检查先完成，再修改源；不重建或合并任何几何。
    assignments = {}
    expected = {
        'CannonBase': Counter(blue=181, white=517, orange=184, outline=348),
        'CannonNozzle': Counter(blue=221, white=179, orange=287, mouth=91, outline=300),
    }
    for name in NAMES:
        mesh = reference['meshes'][name]
        assignments[name] = [identify(c) for c in zip(*[iter(mesh['colors'])] * 4)]
        assert Counter(assignments[name]) == expected[name], (name, '原部件颜色数量不符')
        for i in range(0, len(mesh['indices']), 3):
            assert len({assignments[name][v] for v in mesh['indices'][i:i+3]}) == 1, (name, '三角面跨色')
    backup = Path(tempfile.mkdtemp(prefix='cannon-flat-colors-'))
    for path in (SOURCE, REFERENCE, *(ROOT / 'assets/race/items' / (n + '.glb') for n in NAMES)):
        shutil.copy2(path, backup / path.name)
    print('修改前备份：' + str(backup))
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    for name in NAMES:
        obj, = bpy.data.scenes[name].objects
        mesh = obj.data
        old = reference['meshes'][name]
        colors = mesh.color_attributes.active_color
        assert colors.domain == 'POINT' and colors.data_type == 'FLOAT_COLOR', name
        assert len(mesh.vertices) * 3 == len(old['positions']) and len(mesh.polygons) * 3 == len(old['indices']), name
        for i, v in enumerate(mesh.vertices):
            assert max(abs(a - b) for a, b in zip((v.co.x, v.co.z, -v.co.y), old['positions'][i*3:i*3+3])) < 1e-6, name
            assert max(abs(a - b) for a, b in zip(colors.data[i].color, old['colors'][i*4:i*4+4])) < 1e-6, name
        assert [v for face in mesh.polygons for v in face.vertices] == old['indices'], name
        for target, key in zip(colors.data, assignments[name]):
            target.color = PALETTE[key]
        old['colors'] = [v for key in assignments[name] for v in PALETTE[key]]
        obj['colorPolicy'] = '原色板纯色；无面朝向明暗；运行时直接消费线性顶点色'
        print(name + '：' + json.dumps(dict(expected[name]), ensure_ascii=False))
    reference['note'] = '形状、绕序与描边几何保持来源；底座／喷管按用户要求恢复原色板纯色；水球及落点提醒未修改'
    reference['colorRevision'] = {
        'id': REVISION, 'date': '2026-10-04',
        'reason': '用户反馈固定明暗暗淡，要求取消；同时取消运行时重复颜色转换',
        'sourcePalette': 'art/water-play-obstacles/build_obstacles.py；BYTE_COLOR sRGB 8 位量化后转线性',
        'paletteLinear': PALETTE,
        'outline': '将旧 builtin-unlit 的平方转换离线写入一次，保持原描边明度',
    }
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
    REFERENCE.write_text(json.dumps(reference, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    spec = importlib.util.spec_from_file_location('vfx_export', ROOT / 'scripts/build-entertainment-vfx.py')
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    exporter.export(SOURCE, ROOT / 'assets/race/items', NAMES)


if __name__ == '__main__':
    main()
