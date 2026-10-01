# 卡通角色深肤色遮罩修复（2026-09-05）

本次修复 `CartonSwimmer5/6/8/9/10/11/12ColorMask.png`，不涉及 MuscleMan。

## 逐角色处理

| 角色 | 检查和处理重点 | 遮罩大小，修复前 → 修复后 |
| --- | --- | --- |
| 逐浪少女（5） | 腰部、短裤与黑袜交界；清理闭运算造成的肤色外溢 | 96,181 → 95,278 字节 |
| 跃浪少女（6） | 米白内搭、白袜边界；补全手部肤色，同时保护棕发和粉色配件 | 125,900 → 84,821 字节 |
| 蛙跃潮童（8） | 衣领、袖口、袜口；去除皮肤内部误入的装备色碎点 | 157,560 → 121,724 字节 |
| 霓光灵猫（9） | 白色肩部衣片、腰部和白袜交界；补全裸露皮肤 | 58,009 → 53,581 字节 |
| 青影忍浪（10） | 脸部、双臂与小腿的浅色碎斑；保留护臂、手套、衣服 | 120,696 → 93,963 字节 |
| 疾风浪客（11） | 裸臂、指缝、腿部碎斑；分离偏橙皮肤阴影与橙色装备 | 91,298 → 53,964 字节 |
| 绿电潮童（12） | 浅灰桃色指节、膝盖高光漏染；收紧裤脚和袜口覆盖 | 92,087 → 89,031 字节 |

合计由 741,731 降至 592,362 字节，减少 149,369 字节（约 146 KiB）。这是源 PNG 大小，不能直接当作构建包或显存节省。

## 方法和边界

- 在独立后台 Blender 中读取原始 GLB，以蒙皮表面世界坐标、UV 三角形内原遮罩的高置信度覆盖，辅助识别皮肤。
- 皮肤内部补足覆盖，交界处按照各角色底图的色差识别；不对整张图做膨胀、闭运算或模糊，不跨相邻 UV 岛填色。
- 对米白衣袜、棕发、橙色装备分别保护。11、12 的裸露部位例外来自本次实际模型检查，不能直接套用到其他模型或新的比例。
- 使用 4 倍采样计算颜色覆盖，按面积降采样回 512×512；没有增加运行时纹理分辨率。
- 保留 G 通道和 Alpha。R 通道仅清除明确皮肤内的误染，主要修改 B 肤色通道。
- 7 个 GLB、底图、骨骼、权重、UV、材质、动作和所有既有 `.meta` 文件均保持原字节内容。每个角色仍为 1 个运行时网格、1 个材质、41 根骨骼。
- 未修改 TypeScript 或 effect，不增加帧更新、纹理采样或材质实例。联机与单机使用同一套静态资源；无新增同步状态和结果差异。

## 工具及复查

原始快照、候选、审计报告及渲染保存在本机 `tools/characters/skin-repair-20260905/`，此目录受 Git 忽略。复现本次结果应使用其中的原始遮罩；不要用修复后的遮罩替代原始输入反复迭代。

下面的工具只生成快照、候选和验证图，不会写入 `assets`：

```powershell
& 'F:/blender/blender.exe' --factory-startup -b --python scripts/audit-cartoon-skin-masks.py -- --workdir tools/characters/skin-repair-20260905
python scripts/repair-cartoon-skin-masks.py --workdir tools/characters/skin-repair-20260905
& 'F:/blender/blender.exe' --factory-startup -b --python scripts/render-cartoon-skin-validation.py -- --workdir tools/characters/skin-repair-20260905 --stage before
& 'F:/blender/blender.exe' --factory-startup -b --python scripts/render-cartoon-skin-validation.py -- --workdir tools/characters/skin-repair-20260905 --stage after
```

普通 Python 修复工具依赖 NumPy、SciPy、Pillow；审计与渲染脚本使用 Blender 自带 Python。更换 GLB 或原始遮罩后必须重新逐角色检查，不得无条件覆盖运行时资产。

已完成：

- 原色与深肤色下的正、背、侧视图检查；深肤色搭配青、红、蓝、黄、紫 5 种装备色；蛙泳和挥手动作采样检查。
- 验证材质分别采样底图和遮罩，复现运行时线性空间亮度、装备覆盖阈值和肤色混合；离线渲染用于排查表面误染，不等同于完整 Cocos 渲染或 ASTC 真机结果。
- 通过已运行的 Creator 本地资源接口，只重新导入 7 张遮罩；没有启动或重启编辑器，没有编辑器截图。7 份 library 导入 PNG 的 SHA-256 均与最终源文件相同。
- `npm run textures:fix`、`npm run textures:check` 通过；压缩预设与无 mip 采样策略保持原样。
- `npm run test:characters`：13 项通过；既有 `test_green_recolor_mask.py`：4 项通过。

尚未进行 iOS / Android 微信真机视觉检查。后续应重点确认 ASTC 压缩下的衣袜交界和缩小显示效果。
