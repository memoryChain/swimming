# 逐浪少女角色导入

新增角色 `cartonSwimmer5`，显示名暂定「逐浪少女」。已接入角色选择、准备预览、比赛模型表和 Debug Model；属性沿用现有均衡角色，不改变玩家当前选择。

## 原始资料与运行时资源

- 原始文件：`tripo_convert_5c5e1d58-15e6-4e10-bf50-2b5042c3ca95.glb`，原文件未修改。
- 原始 SHA-256：`256781b2408dcc06ae257ad8a3221cbbf4b73420bc9e4fdcf735e926c9f4e73c`。
- 原始副本、制作 `.blend`、审计报告与离线预览：`tools/characters/tripo_5c5e1d58/`；不进入运行时资源，也不提交本地制作缓存。
- 模型：`assets/race/models/CartonSwimmer5.glb`，575,488 字节，1 个网格、1 个材质、1 个图元、41 根骨骼、5,338 个三角面。源网格 6,834 个顶点，导出接缝拆点后为 6,837 个顶点。
- 底图：内嵌 512×512 JPEG，保留原始图案，不改头发、黑白服装或皮肤底图。
- 遮罩：`assets/race/models/CartonSwimmer5ColorMask.png`，512×512 RGBA，120,547 字节。
- 模型 SHA-256：`b064bae54244825ca9bf68062ffdb99b08beb07aa60630c7777d0437bbf1aa85`。

## 换色

沿用 `SwimmerDynamicColor.effect`，无新增 Shader、材质槽、逐实例生成贴图或赛中 UI 更新。

- R 通道：源图绿色的眼镜、腕表、短裤饰边及鞋部饰件，使用现有服装颜色选择。
- B 通道：面部、手臂、腰腹与腿部皮肤，使用现有肤色选择；暖肤色保留原图，深肤色独立覆盖。
- G 通道保持为零；该角色没有独立泳帽通道。A 通道全不透明。
- 服装与肤色互不覆盖。白色与深色装备保留底图；绿色通道非零像素为 63,394，皮肤通道非零像素为 115,494。

此图集 UV 碎片较多，皮肤与白色装备区域相邻，因此关闭皮肤闭运算，避免填孔时扩大到非皮肤部分。脚本原有默认值不变，既有角色遮罩不受影响：

```powershell
python scripts/generate-green-recolor-mask.py --input tools/characters/tripo_5c5e1d58/basecolor.jpg --output assets/race/models/CartonSwimmer5ColorMask.png --skin-close-radius 0 --preview-prefix CartonSwimmer5
```

## 骨架与动作验证

按照角色导入技能，先统一朝向，再通过 `tools/normalize-character-to-canonical-rig.py` 对齐标准局部轴，不移动关节、不修改网格或权重。重新读取导出的 GLB，与 `MuscleMan.glb` 比较，最大局部旋转误差约 0.000333°。

复用 `model-actions/tPose`，没有复制独立动作目录或重新采样既有动作。离线遍历 21 个动作资源、3,661 个采样，包含跳水准备静态姿势：无缺失骨骼、非有限数值或标准轴参照下的左右手顺序差异。沿用动作原有四元数连续性，不做平滑改写。

另外使用实际 `FreestylePoseController.ts`、Cocos 数学库及保存调参，检查交替、双臂与单右臂划水共 363 帧，数值有限且循环闭合。双臂前伸时左肘约 23.26°、右肘约 22.82°，保留角色原有关节位置，不进行额外镜像或权重修复。

已检查原色、六组高对比服装／肤色组合、九个高风险动作各五帧、跳水准备三视角，以及实际自由泳的俯视与斜视离线渲染。离线贴图预览用于检查分区和变形，不等同于 Cocos 光照、压缩纹理或真机验收。

### 待验收：鞋底接触

按当前通用 Hip 对齐和双骨 IK 规则计算，支撑脚骨骼接触点最大残差约 0.000500 模型单位。但原始鞋底网格在部分舞蹈姿势下仍存在约 -0.01738 至 +0.01417 模型单位的接触偏差，超过 0.001 的网格接地目标，作为明确的视觉验收欠项记录；不能据此宣称所有动作鞋底均完全贴地。未为消除此偏差修改共享动作或其他角色。

## Cocos、压缩与联机

使用当前已运行 Creator 的资源数据库刷新和重新导入，没有启动、重启 Creator，没有截取编辑器或其预览窗口。

已核对 `library` 中实际导入的所有骨骼局部变换、内嵌 JPEG、遮罩 PNG 与运行时文件一致，模型三角面数为 5,338。

- 模型 UUID：`8b36f4bc-c8bc-4738-916c-05f25ac8bbad`。
- 遮罩 UUID：`166caedf-551c-4462-8a60-33f1c89b8a7c`。
- Creator 生成 `.meta` 后执行 `textures:fix`，底图使用模型 ASTC 6×6＋JPEG 回退，遮罩使用模型 ASTC 6×6＋PNG 回退；内嵌 Texture2D 禁用 mip 采样，并已验证实际导入数据。
- 资源位于 `race` 分包，没有向主包 UI 添加压缩纹理。
- 联机沿用共享头像映射和养成摘要传输。新增模型改变共享角色表长度，协议版本由 4 升为 5，拒绝新旧角色表混跑；未新增逐帧网络数据。单机的现有角色、物理和输入逻辑不变。

## 已完成检查

- TypeScript 5.4.5 指定检查命令通过。
- `npm run test:net`：14 项通过。
- `npm run test:characters`：4 项通过，涵盖资源路径、独立肤色切换、养成摘要、协议和模型预算。
- `python tests/test_green_recolor_mask.py`：2 项通过，涵盖配色分类与旧遮罩默认行为。
- `npm run textures:check` 通过，扫描 113 项，纳入压缩 47 项。
- `git diff --check` 通过。

仍需在现有编辑器会话和 iOS／Android 微信真机验证：角色反复切换、准备到跳水衔接、自由泳、肤色／服装配色、舞蹈鞋底接触，以及压缩后的换色边界。此次没有运行平台构建或真机测试。
