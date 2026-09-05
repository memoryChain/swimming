# 绿电潮童：bf613 精修版接入与误替换纠正

日期：2026-09-05。用户明确纠正目标为「绿电潮童」`cartonSwimmer12`。先前把精修版放到「霓绿少女」14 是助手判断错误，已撤销；本文件是此次正确接入记录。

## 最终对应关系

| 游戏角色 | 运行模型 | 当前内容 |
|---|---|---|
| 绿电潮童 12 | `assets/race/models/CartonSwimmer12.glb` | bf613 精修底图，沿用原 12 骨架／UV／权重 |
| 霓绿少女 14 | `assets/race/models/CartonSwimmer14.glb` | 恢复为原 c1b6 银发精修版 |

两者各自使用同名 `ColorMask.png`，没有交换角色配置、属性、稳定 ID、存档、默认选择或动作路径。

## 12 的处理与保真

原 12 经比对证实就是 bf613 同源模型：4085 顶点、5525 三角、41 骨、单网格单材质。UV、JOINTS 与索引逐字节一致；位置、权重和骨轴只有导出浮点级差别。最终直接基于原 12 的 GLB 只换已确认的 512 RGB PNG，不移植误选 14 时生成的骨架。

打包验证：7 个非图像缓冲及节点、骨架、材质、场景等元数据全部不变。原 12 的法线、肩肘关节和权重完整保留，继续复用 `model-actions/tPose`。源 2048 精修文件不变，运行 512 底图仍采用原 UV 烘焙扩边，避免直接缩图的黑裂。

12 原本支持肤色切换，不能搬用误选 14 时的固定肤色配置。本次遮罩采用新精修 R 衣色通道，加原 12 的 B 肤色通道，G 为 0、A 为 255。新 R 和旧 B 各自逐字节保持；60916 个非零 B 像素没有重画。暖肤继续保留原肤色，深肤功能保留；红／蓝衣色与原暖／深肤四组合已重新读取落盘 PNG 做离线局部预览。

这是保留现有功能，不是重新精修原肤色遮罩。原 B 在腕带内侧、护目镜等少量固定暗边存在既有覆盖，深肤近景可使这些内侧暗边略发棕；本次未擅自扩大修改该区域。运行 512 极近景的少量混色软边／像素锯齿也仍需与实际游戏显示尺寸区分。

## 文件和备份

- 12 新模型：643600 字节，SHA-256 `8dd11126ef7f2cf43d13ef6d7ba8ff9284fc726475ee42f5343595448829d25b`。
- 12 新遮罩：71117 字节，SHA-256 `0017bd003a1ef041937933d5fbdf90267a1c8d2fa0320886dde77c210443b41c`。
- 精修运行底图 SHA-256：`ec2070cacf33ec15cff169c9473c5c56e55d2030c745096282f9d1a5c34ea326`。
- 原 12 模型 SHA-256：`6a9badaff82211ab997f0d280e40442fb5b496d354d83d9237fb519c9ca30b38`；模型和遮罩及各自元数据备份在 `tools/characters/bf613_cleanup/runtime-correction/backup-before-correction/`。
- 恢复后的 14 模型 SHA-256：`bacc550794c2bceff1a188cfd16b01cea3d8a955644f84c70e1b76264cffa32d`，遮罩 SHA-256：`2ff191e9d86fc41034d59c2308dbe5120b18736d05e60c8fcc2fa0783d652f28`，均与误替换前备份一致。
- 14 的恢复源保留在 `tools/characters/bf613_cleanup/runtime-backup-c1b6/`；其正式接入记录为 [霓绿少女原精修版](character-import-carton-swimmer14.zh.md)。

12 运行文件合计 714717 字节；无损 PNG 令文件体积高于旧 JPEG 版，但纹理仍为 512，没有升分辨率、增加材质或运行时处理。角色专用回归文件预算更新为 1 MiB，不改变其他角色预算或微信首包限制。

## 导入与验证

- 两个槽位均实际写回运行目录，保留各自 `.meta` 和父 UUID。
- 12 模型 UUID 为 `36bdf8e6-92c0-4fa3-8155-a8e7fdf529af`，遮罩为 `3a167f98-e1eb-4d70-8a91-d6f573cae7fd`；14 的 UUID 保持原值。
- 原 GLB 内部场景名均为 `Scene`，没有为了改名重导出。Cocos Prefab 名分别仍为 `CartonSwimmer12.prefab`、`CartonSwimmer14.prefab`，原加载路径有效。
- `library` 实际网格分别为 12 的 4085／5525 和 14 的 7753／5603；底图和遮罩哈希与对应最终文件相同，预制体到网格／骨架／材质／纹理的引用完整。
- 两角色导入关节位置和逆绑定矩阵误差均为 0，局部旋转最大误差小于 `0.000004°`。
- 激活现有 Cocos 触发扫描，没有启动、重启或截图编辑器。元数据更新后执行 `textures:fix`、`textures:check` 通过；继续 ASTC 6×6 及对应 JPG／PNG 回退，GLB mip 关闭。
- 角色回归 15 项通过，覆盖正确槽位、模型结构、原 UUID、肤色功能和恢复的 14 结构。未修改 TypeScript 运行逻辑、共享着色器、联机配置或中文 UI 文案。

报告位于 `tools/characters/bf613_cleanup/runtime-correction/`：`CartonSwimmer12_Runtime.validation.json`、`carton12-geometry-audit.json`、`carton12-mask-merge-audit.json`、`cocos-import-12.json`、`cocos-import-14.json`。

重新打开已有游戏预览，选择「绿电潮童」验收新精修版；「霓绿少女」应仍为银发原版。实际比赛接地、程序化游泳／过渡和微信 iOS／Android 压缩效果未在本次纠错中实测。未上传外部平台、提交或推送仓库。
