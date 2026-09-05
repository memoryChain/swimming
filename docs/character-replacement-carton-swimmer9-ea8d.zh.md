# 霓光灵猫（ea8d）精修版接入

2026-09-06，依据用户“精修后自动替换，无需逐个审核”的授权，只更新霓光灵猫 `cartonSwimmer9` 的外观。不改变角色属性、默认选择、肤色能力、共享动作或联机配置。

## 身份与保留范围

源文件为 `tripo_convert_ea8d6e41-c696-46ea-a892-01884093f980.glb`；唯一对应旧9的5675面，17025个三角角点骨骼索引一致，朝向对齐后最大位置误差4.52e-7。旧9已经重排UV并标准化骨轴，不能直接使用源GLB替换运行模型。

依据项目贴图、UV与动作技能，将源精修外观离线转贴到旧运行UV，保留全部非图像缓冲、骨架、权重、关节位置、法线和UV。运行保持5679顶点、5675面、41骨骼、单网格、单材质；底图与遮罩均512×512。只重建R衣色覆盖，旧G/B/A逐字节保留。

## 文件与可恢复备份

- 源精修：`tools/characters/ea8d_cleanup/Character_FineRefined_v1.glb`，SHA256 `97f694abd2a59e0c6d225cc3ff8c31db0a9322fa8c39b9f172297ce384e5112d`。
- 运行：`assets/race/models/CartonSwimmer9.glb`，516584字节，SHA256 `fa4d333f542a75de2ec28c126ce2cfe35697f0a549f38ab94d346fc0fb9308be`。
- 内嵌底图：JPEG q95、4:4:4、渐进优化，172537字节，SHA256 `0de5be5b4694e547c301eea113d111103c32251c4dd2c973dd3d31ed82ddb325`。
- 遮罩：`assets/race/models/CartonSwimmer9ColorMask.png`，79971字节，SHA256 `7126ee9f3e20c101f082002ad02cc1c6fe9f20ae28ecc2fe3ef71155b05fe50b`。
- 旧运行模型SHA256 `15ae1fa1986f4644c0e26b74d319f543b5f368d24f4ddd7d8cc91f608c5bcaa1`，旧模型445268字节、旧遮罩53581字节。本次合计增加97706字节，未提高原512KiB模型测试上限。
- 原GLB、mask及两个meta保存在 `tools/characters/ea8d_cleanup/runtime-import/backup-before-replacement/`；没有覆盖桌面原件。

`tools/`为本机忽略目录，不等于已随Git提交或上传。

## 已完成检查

- 真正重导入候选GLB，直接读取其内嵌JPEG；12机位与最终JPEG预览逐像素一致。
- 原色、红蓝黑黄紫衣色及深肤色核验，保留粉色镜片/裙边、白袜等固定设计。
- 235个既有样本（91肢体组件、1入水预备、143挥手）逐样本新旧蒙皮、骨矩阵、肩肘腕、左右手序和脚最低点差均为0；9张动作A/B图未见新增动作瑕疵。
- 安装后85项基线核对仅GLB和mask变化，其他角色、动作、配置、共享shader均未变。
- 主UUID `69faef5c-e87c-45a0-a7e4-bc23f4440089`、mask UUID `15cc9947-ba08-4d5c-bf6c-f6c7ca8bc3bb`及所有子UUID保持不变。
- Creator实际导入图像与mask哈希对应候选；单蒙皮渲染器、材质、网格与骨架计数正确。逆绑定与关节位置误差0，旋转误差约0.000002415度。
- ASTC 6×6及fallback保留、内嵌纹理mip关闭。直接运行与`textures:fix`、`textures:check`相同的策略脚本均通过：159项扫描，71项纳入压缩。
- 15项角色回归测试通过；使用本机缓存tsx 4.20.5，未修改测试预算。

报告在 `runtime-import/installed.json`、`scope-check.json`、`cocos-import-9.json`、`action-validation/`和`texture/`。未启动或重启Creator、未截图编辑器、未手写library缓存。

## 保真与验证边界

512版的银扣、细黑扣相对2048源版更软，极近景仍有少量细绿边。旧B通道会使部分金色配件跟随深肤色变深，本次保留旧语义，未声称已修复。蛙泳样本鞋底附近的小肤色块在新旧同位置均可见，未进一步断言是贴图还是几何重叠。

离线动作检查不覆盖完整自由泳控制器、程序化躯干、动态过渡及游戏接地IK。没有微信iOS/Android实机ASTC视觉验收。验收需重新加载现有游戏预览，选择“霓光灵猫”；旧运行中的预览可能仍持有旧纹理。
