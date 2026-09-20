# 冷静冰沙低多边形道具

冷静冰沙是心跳苏打玩法中的低概率公共补给。造型采用矮胖切面杯、冰沙穹顶、短吸管和正反两面的雪花标记，远看与心跳苏打的瓶形轮廓明显不同。

- 单网格、单材质、顶点色，不使用贴图、透明玻璃、动态灯光或阴影。
- 主色为冰蓝和青白，杯底保留深蓝压重，适配蓝白光柱。
- 源文件与运行时 GLTF 均由 `build_calm_slush.py` 确定性生成。

从项目根目录运行：

```powershell
python scripts/run-blender.py -- --python art/calm-slush/build_calm_slush.py
```

脚本保存 `art/calm-slush/CalmSlush.blend`，并导出 `assets/race/items/CalmSlush.gltf`。
