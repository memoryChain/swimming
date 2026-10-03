# 定时水球源稿

来自固定审查提交 `e5dca0327ed8d5e70bf5f38d39489022491e8e4b`。`TimedWaterBalloon.blend` 是原作者源稿；运行时模型为 `assets/race/items/TimedWaterBalloon.glb`，当前保持原导出内容。

`build_balloon.py` 和 `paint_warning.py` 可在独立后台 Blender 重建同一模型、警示图案及 GLB。输出留在本源稿目录；重新交付时核对后复制 GLB 到运行时路径，保留既有 `.meta`。不要把 `.blend` 或预览放入 assets。

仓库根目录的验证入口：

```sh
python3 scripts/run-blender.py -- --python scripts/audit-water-balloon-blender.py
npx --yes --package typescript@5.4.5 -c "node scripts/sample-water-balloon-mounts.cjs"
npx --yes --package typescript@5.4.5 -c "node scripts/audit-water-balloon-clearance.cjs"
```

Windows 将 `python3` 改为 `python`、`npx` 改为 `npx.cmd`。骨架数学验证读取当前 Creator 生成的 `temp/tsconfig.cocos.json`；没有本机引擎时不能将检查视为通过。

挂点采样读取主干全部角色实际蒙皮，不修改角色；生成 `mounts.json` 和 `assets/scripts/character/TimedWaterBalloonMount.ts`。修改角色模型、模型缩放或水球形状后重新运行挂点与间距检查。

`blender-audit.json` 记录源稿和 GLB 的几何、尺寸、连接与文件身份；`clearance-audit.json` 记录实际水球动画的各部件包围盒及 12 角色关键姿态的头部、手臂采样间距。它们是离线验证，不能代替 Creator 画面和微信真机体验。
