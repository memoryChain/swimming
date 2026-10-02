"""独立后台渲染两种真实角色的基础转体连续对照，不访问 Creator。"""
from pathlib import Path
import sys
import subprocess
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
MODE = 'ai' if '--ai' in sys.argv else 'player'
PREVIOUS = '--previous' in sys.argv
OUT = ROOT / '.cache' / f'freestyle-body-roll-runtime-{MODE}'


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    for col, model in enumerate(['MuscleMan.glb', 'CartonSwimmer13.glb']):
        baseline = 'previous' if PREVIOUS else 'before'
        for row, folder in enumerate([f'freestyle-body-roll-runtime-{MODE}-{baseline}', f'freestyle-body-roll-runtime-{MODE}']):
            # 动画根节点有自己的位置轨道，排列偏移交给独立父节点，避免播放后重叠。
            layout = bpy.data.objects.new(f'PreviewLayout_{col}_{row}', None)
            scene.collection.objects.link(layout)
            layout.location = (col * 3.7, row * 2.2, 0)
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=str(ROOT / '.cache' / folder / model))
            for obj in set(bpy.data.objects) - before:
                if obj.parent is None:
                    obj.parent = layout
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 4
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 800
    scene.render.resolution_y = 450
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.color = (.5, .5, .5)
    scene.view_settings.view_transform = 'Standard'
    bpy.ops.object.light_add(type='AREA', location=(3, -4, 8))
    bpy.context.object.data.energy = 1000
    bpy.context.object.data.size = 8
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 7.6
    scene.camera = camera
    views = [('oblique', (2.7, -7, 8)), ('side', (2.7, -8, 3.0))]
    if '--oblique-only' in sys.argv:
        views = views[:1]
    elif '--side-only' in sys.argv:
        views = views[1:]
    for view, position in views:
        camera.location = position
        camera.rotation_euler = (Vector((2.7, 1.1, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        target = OUT / view
        target.mkdir(exist_ok=True)
        for i in range(120):
            scene.frame_set(i)
            scene.render.filepath = str(target / f'{i:03}.png')
            bpy.ops.render.render(write_still=True)
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-framerate', '30', '-i', str(target / '%03d.png'),
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
                        str(OUT / f'{view}.mp4')], check=True)
    review = (ROOT / 'scripts/templates/freestyle-body-roll-review.html').read_text(encoding='utf-8')
    if PREVIOUS:
        review = review.replace('下排：原游姿', '下排：上一版骨盆与胸肩转体').replace('上排：转体实验', '上排：整个模型侧倾')
        review = review.replace('第一轮实验', '整个模型侧倾对照')
    if '--recovery' in sys.argv:
        if not PREVIOUS:
            raise ValueError('回臂对照必须使用 --previous 和已认可转体版本的导出')
        review = review.replace('下排：上一版骨盆与胸肩转体', '下排：原回臂').replace('上排：整个模型侧倾', '上排：收敛回臂')
        review = review.replace('整个模型侧倾对照', '保留转肩，收敛回臂')
        review = review.replace('先让划水具有连续的胸肩侧转，再决定是否叠加换气。这一版暂不播放旧换气动作。',
                                '两排转肩幅度与时序完全相同，只比较回臂时手的抬高、外摆与屈肘。暂不播放旧换气动作。')
        review = review.replace('重点看肩线和背部是否随左右划水连续变化，骨盆是否小幅跟随，头是否保持稳定。肌肉男原本已有转体，本版统一时序与关节配合；其他角色增加胸肩与骨盆联动，不以“所有角度都更大”作为验收标准。',
                                '重点看手是否更贴近身体回到前方，以及出水、回臂、入水能否连续衔接。肌肉男保留原高肘曲线；深潜先锋等角色增加适度屈肘，收小直臂甩出的幅度。')
        review = review.replace('实验目录', '当前蝶泳开发分支')
    (OUT / 'index.html').write_text(review, encoding='utf-8')


if __name__ == '__main__':
    main()
