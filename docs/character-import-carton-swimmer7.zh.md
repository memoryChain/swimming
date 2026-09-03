# 疾浪少年角色导入

新增 `cartonSwimmer7`，显示名暂定「疾浪少年」。已加入共用角色和模型表，供角色选择、准备预览、比赛及 Debug Model 使用。属性沿用现有均衡角色。

## 来源和资源

- 原始文件：`tripo_convert_027c8dbb-ed52-42d2-806b-da799f046c4c.glb`，未修改。
- 原始 SHA-256：`f5d6968448a0f72d22ea54836c6eb0ee6f13aa204dc3f42f78afe3169dde2c05`。
- 原始副本、制作 `.blend`、审计报告和离线预览：`tools/characters/tripo_027c8dbb/`，不进入运行时资源。
- 模型：`assets/race/models/CartonSwimmer7.glb`，601,928 字节，1 个网格、1 个材质、1 个图元、41 根骨骼、5,364 个三角面。源网格 7,129 个顶点，导出接缝拆点后 7,134 个顶点。
- 模型 SHA-256：`d3643e01c6bf36e63b6c397f03b7ef2451f8f2e9fe297a76f1d1498b04d6c07e`。
- 内嵌底图为 512×512 JPEG，与原始底图逐字节一致。
- 遮罩：`assets/race/models/CartonSwimmer7ColorMask.png`，512×512 RGBA，134,823 字节。

## 换色区域

复用现有 `SwimmerDynamicColor.effect`，未增加 Shader、材质槽或逐实例纹理生成。

- R：源图黄绿色胸前饰块、腕带、腰包、腰带、短裤饰块和鞋部饰件，统一使用服装颜色。
- B：面部、耳朵、颈部、手臂、手和腿部皮肤，使用独立肤色。暖肤色保留原图，深肤色使用既有配色。
- G 为零，A 全不透明，没有独立泳帽通道。
- 橙色帽子、袖口和饰件、墨镜、头发及黑白装备保留原色。

黄绿色的色相偏离旧绿色规则，新增可选 `lime` 装备配色规则。橙色装备容易被普通暖肤色分类覆盖，因此新增可选 `peach-orange` 肤色规则，通过饱和度排除橙色。两项均不改变旧默认值，未重新生成其他角色遮罩。关闭皮肤闭运算以保护碎片 UV 之间的装备边界。

```powershell
python scripts/generate-green-recolor-mask.py --input tools/characters/tripo_027c8dbb/basecolor.jpg --output assets/race/models/CartonSwimmer7ColorMask.png --skin-close-radius 0 --skin-palette peach-orange --garment-palette lime --preview-prefix CartonSwimmer7
```

最终绿色非零像素 28,610，皮肤非零像素 79,156。检查了原色、六组高对比换色，以及正面、背面和侧面边界。预览保存在制作目录的 `recolors.jpg` 和 `preview.jpg`。

## 骨架和动作

Blender MCP 连接不可用，使用后台 Blender 5.1.2，未操作用户当前 Blender 场景。先保存源审计文件，统一朝向（绕竖轴 -90°），再运行 `tools/normalize-character-to-canonical-rig.py` 对齐标准局部轴。

骨骼名称与层级全部对应。原始最大骨架基准差约 51.89°；标准角色与新角色的最大关节位置差约 0.07271 模型单位，因此保留新角色的关节中心，只统一轴向。关节移动、顶点移动和权重行改动均为零。重新读取导出的 GLB 后，最大局部旋转误差约 0.000162°。

复用 `model-actions/tPose`，未复制独立动作目录或修改共享动作。离线遍历 21 个动作资源、3,661 个采样，包含跳水准备；无缺骨、非有限网格数值或相同关节位置标准轴参照下的左右手顺序差异。已检查九个高风险动作各五帧及跳水准备三视角。

使用实际 `FreestylePoseController.ts`、Cocos 数学库和保存调参检查交替、双臂及单右臂划水，共 363 帧，数值有限、循环闭合。双臂前伸时左肘约 10.50°、右肘约 16.73°，保留源模型关节差异；检查了双臂划水的俯视和斜视离线渲染。

### 接地验收欠项

通用 Hip 对齐和双骨 IK 离线计算的支撑骨骼残差最大约 0.000500 模型单位。部分舞蹈姿势的鞋底网格仍有接地偏差，全部采样的最低鞋底为 -0.02792，支撑鞋底最高为 +0.00976 模型单位，超过 0.001 网格接地目标。此项记录为视觉验收欠项，不能据此宣称所有舞蹈鞋底完全贴地。未修改源鞋型、权重或共享接地逻辑。

## Cocos、压缩和联机

通过已运行 Creator 的资源数据库刷新及重新导入生成 `.meta`，未启动、重启或截取 Creator。已核对 `library` 内所有骨骼局部变换、内嵌 JPEG、遮罩 PNG 和三角面数与最终资源一致。

- 模型 UUID：`76d49b5c-1b4b-49b3-80a9-e1ca3ee1ac9a`。
- 遮罩 UUID：`7d1bee86-e900-4c98-8be2-017fe254d061`。
- Creator 生成元数据后运行 `textures:fix`，底图使用 ASTC 6×6＋JPEG 回退，遮罩使用 ASTC 6×6＋PNG 回退；内嵌 Texture2D 关闭 mip 采样，并已核对实际导入数据。
- 模型和遮罩共约 720 KiB，放在 `race` 分包；未增加主包 UI 纹理。平台构建后的压缩体积尚未测量。
- 新增模型改变共享角色表长度及头像映射，联机协议由 6 升为 7，拒绝新旧角色表混跑。继续使用现有头像派生外观及养成摘要传输，未新增逐帧网络数据。单机继续使用本地角色与配色选择。

## 检查结果

- TypeScript 5.4.5 指定检查通过。
- 角色测试 7 项、网络测试 14 项、遮罩测试 4 项通过。
- `textures:check` 通过，扫描 117 项、纳入压缩 51 项。
- `git diff --check` 通过。
- 原始文件、运行时底图和 Cocos 导入子资源已核对。

离线渲染用于检查分区和变形，不等同于引擎光照或真机验收。未运行平台构建、编辑器交互预览或微信真机测试；仍需在现有编辑器会话及 iOS／Android 微信设备确认反复切换角色和配色、准备到跳水衔接、自由泳、舞蹈鞋底接触与压缩后的边界。
