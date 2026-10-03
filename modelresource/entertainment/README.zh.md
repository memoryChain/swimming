# 娱乐道具 Blender 源与 GLB

`EntertainmentItems.blend` 是六种娱乐道具的可编辑源，使用 Blender 5.2.1 LTS 制作。源文件不进入 Cocos 包；运行时只使用 `assets/race/items/` 内的六个 GLB。

## 道具和预算

| Blender 场景／GLB 文件名 | 用途 | 三角面 | GLB 字节 |
| --- | --- | ---: | ---: |
| StimulantBottle | 苏打补给，恢复体力及现有兴奋效果 | 320 | 21,864 |
| CalmSlush | 冰沙补给，降低心率及现有降温效果 | 256 | 21,980 |
| ColaBottle | 可乐瓶硬杂物，碰撞减速与反弹 | 236 | 16,748 |
| CrushedWaterBottle | 压瘪矿泉水瓶硬杂物，规则与其他硬杂物一致 | 172 | 13,056 |
| SportDrinkBottle | 运动饮料瓶硬杂物，规则与其他硬杂物一致 | 196 | 13,952 |
| MealTray | 泡沫餐盒软杂物，持续阻力并可被推走 | 144 | 10,744 |

合计 1,324 个三角面、98,344 字节，约 96.0 KiB。每个 GLB 只有一个场景、一个节点、一个 Mesh、一个 primitive 和一个无光照顶点色材质；没有图片、UV、骨骼、动画或相机。新导出未增加三角面数；硬边法线会拆分导出顶点，六件合计 2,590 个运行时顶点。

## 编辑约定

- 顶部场景列表选择道具；每个场景有一个 `*_Editable` 集合。苏打拆成瓶体、内容物、瓶颈、连接环、瓶盖、前后徽记；冰沙拆成杯体、冰沙、吸管、前后雪花；餐盒拆成底盘、盖、四周外沿、铰接、污渍和分隔条。
- 三种横放瓶子使用连续四边面截面和两个完整端面，顶点组可选择瓶盖、瓶颈、瓶身／标签和底部。每个对象的 Mesh 独立，不使用链接副本。
- 单位为米。Blender 使用 Z 向上，导出脚本转换到 Cocos 的 Y 向上，并应用全部对象变换；保留既有游戏原点、大小、局部朝向和漂浮参数。不要为方便源预览改变运行时基准。
- 颜色保存在名为 `Color` 的角点颜色属性中，使用线性值；旧版 sRGB 色板只在制作时转换一次。材质通过顶点色直接连接 Output，导出为 `KHR_materials_unlit`。运行时浮物 shader 直接读取线性 `COLOR_0`，不重复转换、不叠加环境光。
- 源场景只保留模型，不保存预览相机和灯光。修改器应在导出前应用。保留场景、功能对象和网格的稳定名称，以便检查接触及保护 Cocos 子资源身份。

## 导出与检查

在项目根目录运行；Windows 使用 `python`，macOS 使用 `python3`：

```sh
python3 scripts/run-blender.py -- --python scripts/build-entertainment-items.py -- export
python3 scripts/check-entertainment-items.py
```

`export` 打开已保存源文件，检查闭合边、正体积、独立 Mesh、部件表面接触和面数预算；临时合并后只导出当前场景。六件全部检查成功后才替换运行时 GLB，不覆盖 `.meta`。`export-report.json` 保存源部件、接触面检测和导出预算。

Creator 在现有会话中导入后运行：

```sh
python3 scripts/check-entertainment-items.py --imported
npm run textures:fix
npm run textures:check
```

`--imported` 校验真实 `library` Mesh 的位置、法线、颜色、索引字节，以及 Prefab 资源名、单 MeshRenderer 和父子变换。两个补给的主 UUID、网格／材质子 UUID 沿用旧资源；Creator 重建了 Prefab 子 UUID，旧子资源无库内引用，已清理失效记录，逻辑路径保持原名。四种杂物使用 Creator 首次导入生成的 `.meta`。这六件没有嵌入图片，压缩与 mip 策略无需增加配置。

离线源预览（预览辅助对象不写回源文件）：

```sh
python3 scripts/run-blender.py -- --python scripts/preview-entertainment-items.py -- --output /tmp/entertainment-preview
```

请将预览输出到 `assets/` 以外。灰模有六个正交方向；颜色图使用统一无光照条件，仅表示源模型，不能替代 Cocos 的水线／相机及真机验收。

## 可复现基准和已修问题

`legacy-reference.json` 保存本次迁移前提交 `5f6b6d1` 的六件几何和色板，单位、坐标及色彩空间在文件头声明。它是迁移比较资料，不是运行时模型生成代码。`scripts/entertainment-item-recipes.py` 保存制作配方；`rebuild` 可重新建立源文件，但发现已有 `.blend` 时会拒绝覆盖，以保护人工修改。

检查保留外包围盒、原始顶点及色板，明确允许以下内侧接触修复：冰沙雪花内表面向杯壁延伸；餐盒盖／污渍／分隔条底面延伸 1mm，外沿底面延伸 7mm。三角面和外轮廓预算保持不变。之后若批准改变轮廓／配色，应同步维护比较基准和审查记录，不通过静默放宽检查掩盖差异。

游戏端已删除 `LitterDebrisGeometry.ts`；杂物赛前加载四个 GLB，从唯一 MeshRenderer 读取共享 Mesh，仍使用六个固定槽位和唯一水线材质。补给继续使用原来的固定池、路径和效果规则。普通赛、联机、教学与 Boss 均不加载这些本地娱乐调试资源。
