# 深潜先锋 · 308a0775 精修模型接入记录

日期：2026-09-06。状态：精修运行 GLB 与新遮罩已替换到深潜先锋槽位；Creator 已完成实际重新导入，资源一致性、压缩策略与替换范围检查通过。

- 用户先前对「蛙跃潮童」的指定已撤销，最新明确替换「深潜先锋」：唯一目标为 `cartonSwimmer13`，不是新增角色；`cartonSwimmer8` 及其他角色不动。
- 批准源为 `tools/characters/308a0775_cleanup/Character_FineRefined_v3.glb`，SHA-256 `c26529a1b9b8939143c4c5dbeaf7e905d577bddd535e8685038c97a054e36287`；用户纠正链及替换前基线见同目录 `runtime-import/identity-authorization.json`。
- 运行目标为 `assets/race/models/CartonSwimmer13.glb` 与 `CartonSwimmer13ColorMask.png`；保留模型 UUID `8306d5f9-36fc-49e5-b914-16754b9290aa`、遮罩 UUID `1d3a072e-4efd-498c-ad0e-d013d050dde4`。
- 名称、稳定 ID、角色属性、技能、原 `modelScaleMultiplier: 0.97`、`supportsSkinTone: false` 均不变；不因新外观改名，不新增肤色切换。
- 源与旧 13 不是同一网格。候选保留新源 1 网格、1 材质、7,896 顶点、5,562 三角面、41 骨；不重排 UV、不改权重或拓扑、不作额外缩放。
- 运行骨架作 270° 朝向对齐与标准骨轴规范化；关节枢轴不移动，UV、关节索引、权重、三角索引逐字节保留，位置／法线仅作精确轴置换。继续共享 `model-actions/tPose`，不复制整套角色专属动作。
- 骨轴候选重新导入的最大局部基轴误差约 `0.000420°`，关节位置误差约 `3.97e-7`，静止网格误差约 `9.38e-7`；21 项共享动作共 3,661 样本、另 235 个生产姿态样本的数值对照通过。最终 512 GLB 在 Blender 重新导入后，235 个关键样本相对规范骨轴候选的骨矩阵与变形顶点差均为零，三张实际 512 姿态图已目检。数值通过不等于全动作视觉验收通过。
- 运行底图候选为 512×512 JPEG Q95 4:4:4，原 UV 下离线扩边／超采样处理；遮罩按新 UV 重建，不套用旧 13 遮罩。R 仅控制原绿色设计区，G/B 为零、A 为不透明，保留源肤色。
- 已保存源 2048／运行 512 的四向与近景对照，以及红、蓝、黄、紫、黑换色预览；这些是实际落盘贴图的离线回贴与现行换色公式复现，不是 Cocos 场馆光照或 ASTC 真机效果。
- 动作保留问题：现有拍手逻辑对该窄肩长臂体型仍有手臂交叉／掌面接触问题，本轮未调整共享算法；不能将其标记为视觉通过。
- 接地保留问题：离线复现现有 Hip 接地／两骨 IK 后，部分站立／舞蹈的脚蹼表面仍超过 `0.001` 模型单位的支撑误差，例如 `dancing_twerk` 约 `0.00611`、`twist_dance` 约 `0.00995`。旧13对应约 `0.01086`、`0.01130`，但其他动作也有新模型误差较大的情况，不能笼统声称全部改善。报告尚未乘游戏显示缩放，必须保留为接地债项，不宣称完美接地。
- 画质限制：512 原色镜片比2048源图略柔；超近景黑色换装的镜片与脚蹼边缘仍有细微暗绿过渡。灰白发束、固定装备与原绿色独立短件保留，没有以删除设计消除边界。
- 尚未完成：完整程序化自由泳、跳水飞行及状态过渡的实机验收；微信 iOS／Android ASTC 实机画质与性能验收。不能以骨节点接地或浏览器刷新代替这些检查。
- 最终运行 GLB：583,140 字节，SHA-256 `f475b24383b21139032ec3016aff00b97c3bc0b8158252a546e512091dc8a075`；内嵌底图：126,100 字节，SHA-256 `59368c4b792960385b0836e306f11e4bcbc467244e09b93952607bb7bdab8632`；遮罩：27,411 字节，SHA-256 `a766093ce84ddda49ff70decaa3a18bd165bace542787e9331563080db5be26f`。模型与遮罩合计610,551字节，比旧版602,788字节增加7,763字节（约1.29%）；未增加材质／网格数量或512贴图预算。
- 游戏资产于本地时间10:36完成覆盖；10:39确认现有Creator会话完成重新导入，没有启动／重启或截图。导入库实际为7,896顶点／5,562三角／41骨，单蒙皮渲染器；模型／遮罩顶层UUID及全部子资源UUID保持，内嵌JPEG和遮罩PNG与导入库逐字节一致，关节位置／缩放及逆绑定误差为零，局部旋转误差不超过`0.000002415°`。
- 重新导入后执行项目`textures:fix`／`textures:check`的同一策略脚本入口，均通过（当前shell无npm，使用已安装Node运行`extensions/wechat-race-subpackage/texture-compression-policy.js --fix/--check`）。底图ASTC 6×6＋JPEG回退、遮罩ASTC 6×6＋PNG回退，mip关闭；扫描188项无额外策略改动。这不代表实际ASTC构建／真机效果已验收。
- 最终89份模型／共享动作／相关配置文件的范围核验通过：仅13的GLB、遮罩PNG以及Creator自动更新三角数的GLB`.meta`变化，8及其他角色、共享动作和配置全部不变。无需手改`library`或用浏览器刷新冒充重导入。
- 回退备份为 `tools/characters/308a0775_cleanup/runtime-import/backup-before-replacement/` 中旧13模型、遮罩与两份`.meta`。仅需恢复这四份目标文件并重新导入，不回退其他角色或整个工作区。
- 本轮未修改运行代码、角色数值、网络协议或共享动作数据；同版本客户端沿用同一角色 ID，未增加影响比赛结果的逻辑或逐帧开销。
- 骨架证据见制作目录 `runtime-import/rig/{preserved-buffer-report,shared-actions-detailed,production-samples-detailed,contact-audit,final-runtime-reimport}.json`；贴图证据见 `runtime-import/texture/runtime-texture-audit.json`；安装／范围／Creator状态见 `runtime-import/{installed,scope-check,cocos-import-13}.json`。制作源与预览不进入 `assets/`。
- 其他任务的 Pool `.meta` 与 `PrepareRaceFlow.ts` 改动原样保留，本轮不归并、不回退、不提交；最终复核 8 的四份模型／遮罩资源与授权基线完全一致。
