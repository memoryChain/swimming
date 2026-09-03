# 劲浪猛将角色导入

角色标识为 `cartonSwimmer4`，加入角色选择、比赛模型表及 Debug Model，能力值沿用现有均衡角色。默认选择仍由玩家现有选择决定。

## 资源与换色

- 原始文件：`tripo_convert_82688dad-7e41-4513-a892-f243de320ce3.glb`。
- 原始 SHA-256：`e7683df3964a4c2152f5647dfac6ac84560266f57605db0814408c4c47797291`。
- 原始副本、审计文件、标准化 `.blend`、动作报告和预览保存在 `tools/characters/tripo_82688dad/`，该目录属于本地制作资料，不进入运行时资源。
- 运行时模型：`assets/race/models/CartonSwimmer4.glb`，单网格、单材质、单图元、41 根骨骼、7,798 个顶点、5,651 个三角面；底图为内嵌 512×512 JPEG。
- 换色遮罩：`assets/race/models/CartonSwimmer4ColorMask.png`，512×512 RGBA。R 通道覆盖原始绿色的背带、腕带、眼镜框、短裤饰边、袜子和鞋部饰件；B 通道覆盖皮肤；G 通道保持为零。黑白装备保留底图颜色。
- 使用现有 `SwimmerDynamicColor.effect`。服装颜色与肤色分别控制，默认暖肤色保留原图；深肤色通过 B 通道覆盖。所有实例共用底图和遮罩，没有逐角色生成运行时贴图，没有新增材质槽。

遮罩生成命令：

```powershell
python scripts/generate-green-recolor-mask.py --input tools/characters/tripo_82688dad/CartonSwimmer4_BaseColor.png --output assets/race/models/CartonSwimmer4ColorMask.png
```

## 骨架与动作

原始模型整体绕 Blender Z 轴旋转 -90°以统一朝向，再使用 `tools/normalize-character-to-canonical-rig.py` 对齐标准骨骼局部轴。标准化阶段关节位置变化、网格顶点变化和权重变化均为零。重新读取导出的 GLB 后，41 根骨骼与 `MuscleMan.glb` 的最大局部旋转误差约为 0.00025°。

复用 `model-actions/tPose`，没有增加独立动作目录。离线检查 21 个动作资源、共 3,661 个采样，包含跳水准备静态姿势：无缺失骨骼、无非有限数值，标准轴向参照下左右手顺序无差异。动作原有四元数变化保留，未重新采样或平滑已有动作。

按现有通用 Hip 对齐及双骨 IK 规则计算，支撑脚骨骼接触点的最大残差约 0.000499 模型单位，目标均可达。**这不代表鞋底网格完全贴地**：保留原鞋型后，部分舞蹈姿势仍测得约 -0.0135 至 +0.0122 模型单位的接地偏差，超过 0.001 的网格接地目标，作为后续视觉验收项记录。没有为此修改共享动作或其他角色。

已查看原色、六组服装/肤色组合、九个高风险动作的各五帧预览，以及跳水准备的正面、侧面、斜侧面，共 57 张 Blender 离线渲染。它们用于检查模型与遮罩，不等同于 Cocos 或手机端画面验收。

### 右肘修复（2026-09-03）

最初的局部轴标准化和共享动作验证没有覆盖程序驱动的赛中自由泳。实际复现后发现：模型左右手臂表面基本对称，但原始右侧肩、肘、腕的位置明显偏移；右前臂的关节连线与标准局部轴夹角约 44°。自由泳的方向求解与翻掌叠加后，右肘出现不合理折弯。只移动关节仍会造成皮肤拉扯，因此需要同时修正这一角色的右臂权重。

以已验证的左臂为参照，修正右侧上臂、前臂、手及对应扭转骨共 7 个关节的位置，保留标准局部旋转轴。仅对右臂匹配表面转移权重：精确匹配优先，否则使用最近三角面的重心插值；距离超过 0.002 模型单位的非对称表面保持原权重。共修改 1,057 个顶点的权重，每顶点最多 4 个影响，裁减后重新归一化。网格坐标、法线、UV、三角面索引和内嵌底图逐项比较均无变化，换色遮罩不变。

可复现脚本使用第一次导入保留的标准轴向制作源文件，输出制作文件放在 `tools/`：

```powershell
& 'F:/blender/blender.exe' --background --python-exit-code 1 --python scripts/repair-carton-swimmer4-right-arm.py -- --source tools/characters/tripo_82688dad/CartonSwimmer4_CanonicalAxes.blend --output tools/characters/tripo_82688dad/CartonSwimmer4_RightArmFixed.glb
```

当前运行时 GLB 的 SHA-256 为 `aa76a7b38afd40c7b7da361eb36a6140f63fc2aac1675abf4dd11a8ccea36b9d`。

使用现有 `FreestylePoseController.ts`、Cocos 数学库和保存的调参数据，在离线节点变换环境中采样交替划水、双臂划水和单右臂划水，共 363 帧。双臂前伸时，右肘弯曲从 57.43°降至 5.28°，左肘保持 2.92°；整个双臂周期的最大左右弯曲差从 54.86°降至 7.02°。全部采样数值有限，循环首尾连续。再次检查 21 个共享动作资源、3,661 个采样，并对挥手、拉伸、鼓掌、舞蹈、蛙泳和跳水准备进行离线画面对比。验证资料见本地 `tools/characters/tripo_82688dad/CartonSwimmer4_RightArmFinalAudit.report.json`、`CartonSwimmer4_RightArmActionsValidation.report.json` 和 `right-elbow-race-comparison.jpg`。

当前已打开的 Creator 自动重新导入了模型；核对实际导入的 Prefab，右肩、肘、腕局部位置与修复 GLB 一致，资源 UUID 保留。TypeScript 5.4.5、`textures:fix`、`textures:check` 通过。此次修复仅更换角色绑定，不改共享动作、比赛控制代码或联机状态，因此没有新增网络同步数据。离线渲染尚不能替代真机赛中画面验收。

## 联机与导入检查

联机外观沿用现有共享头像映射；能力值沿用角色表与养成摘要解析。新增角色会改变角色表长度，旧版本缺少该角色定义，因此 `NET_RACE_PROTOCOL_VERSION` 从 3 更新为 4，阻止新旧角色表混用。没有增加逐帧网络字段或比赛 UI 工作。

Creator 命令行后台导入生成 `.meta`，再运行 `npm run textures:fix`、`npm run textures:check`。底图使用项目模型压缩策略及 JPEG 回退，遮罩使用模型透明纹理策略及 PNG 回退；内嵌纹理禁用 mip 采样。资源位于 `race` 分包。

TypeScript 5.4.5 检查、现有 14 项联机测试和 Creator 网页构建通过。压缩策略修复后再次完成后台导入与构建，确认 `library` 中的实际 Texture2D 已禁用 mip 采样，构建后的 `race` Bundle 包含模型 Prefab 和遮罩 Texture2D 的配置路径。真实 iOS/Android 微信小游戏的压缩纹理、准备界面、自由泳、跳水衔接和鞋底接触仍需设备验收。
