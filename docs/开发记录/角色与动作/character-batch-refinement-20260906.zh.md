# 2026-09-06 批量角色精修交付

按“精修后直接进游戏，无需逐个审核”的授权执行。采用项目贴图精修、UV转贴和动作技能，原设计保留、各角色独立制作和复核，安装由主流程串行完成。源文件/制作过程留在tools，不把2048源图、blend和备份放入assets。

| 用户源前缀 | 角色 | 操作 | 精修源位置 |
| --- | --- | --- | --- |
| ea8d6e41（上一件） | 霓光灵猫9 | 替换外观 | `tools/characters/ea8d_cleanup/Character_FineRefined_v1.glb` |
| 3e3a79de | 疾风浪客11 | 替换外观 | `tools/characters/3e3a79de_cleanup/Character_FineRefined_v2.glb` |
| 5c5e1d58 | 逐浪少女5 | 替换外观 | `tools/characters/5c5e1d58_cleanup/Character_FineRefined_v1.glb` |
| 790f398d | 跃浪少女6 | 替换外观 | `tools/characters/790f398d_cleanup/Character_FineRefined_v2.glb` |
| 06de2884 | 破浪机甲15（暂名） | 新增，不覆盖旧角色 | `tools/characters/06de2884_cleanup/v2/Mecha06de_FineRefined_v2.glb` |

运行模型统一在 `assets/race/models/CartonSwimmer{id}.glb`，同目录`CartonSwimmer{id}ColorMask.png`为遮罩。每个旧角色四份原文件均备份在其制作目录`runtime-import/backup-before-replacement/`；原UUID及所有非图像运行结构保留，尤其11的旧左肘与权重修正不回退。

## 当前状态

2026-09-06 01:08：五个模型文件均已安装到正确槽位，总85项初始范围核对通过；旧角色除授权的5/6/9/11外均未变化，旧meta、共享动作和shader未改。3项配置变化用于新增机甲，同时保留并行任务的角色头像映射。

- 霓光灵猫9、疾风浪客11：Creator真实library对应精修候选，已核对UUID、内嵌图、mask、mesh、skin与绑定。
- 逐浪少女5、跃浪少女6：运行文件已替换，写记录时Creator缓存仍是旧图，等待现有窗口扫描。
- 破浪机甲15与卡面：已写入assets及角色配置，写记录时新meta尚未生成；未宣称引擎导入完成。

需要切回已经打开的Creator窗口，让其扫描改动；不需要重启。扫描后对15及卡面运行`textures:fix`/`textures:check`，再执行各角色`runtime-import/verify_cocos_import.cjs`并更新本记录。不能手写library来伪装完成。

## 已通过检查

- 4个旧角色各235动作样本变形零差；新机甲21组3661骨轴样本及235生产语义样本，细节见各角色报告。
- 最终内嵌JPEG重导入、原色和五色多角度；衣色R单独修复，旧G/B/A不动，新机甲无肤色通道。
- 26项角色/协议测试、18项房间测试，TypeScript5.4.5无输出通过；字体生成后1237字审计通过。
- 已导入部分的纹理策略169项/81压缩通过，**此数字尚不包含缺meta的新15资源和卡面**；不能用该次策略通过代替新增资源完成。

## 保真边界与成本

运行仍512，未加材质/网格/每帧处理；相较2048源精修，细滚边、框扣和发带仍受512像素软边限制。现有近纯色换色会压低同色内部细纹对比，本轮未修改全局shader。没有微信iOS/Android真机、实际ASTC画面、完整自由泳和场馆接地IK验收。

4个旧角色GLB+mask合计增加361199字节；新增机甲GLB+mask+卡面857851字节，总源资产净增1219050字节，不含meta、字体差额和构建派生文件。所有新增大文件在race分包，不占resources首包；仍需实际微信构建预算审计。

源制作目录tools被Git忽略，未声称已上传、提交或推送。可追溯总清单：`tools/characters/batch-20260906/batch-audit.json`；本轮审计脚本为同目录`audit_batch.cjs`。
