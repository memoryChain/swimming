# 疾风浪客（3e3a）精修接入

2026-09-06，依据用户批量精修后自动接入的授权，仅替换疾风浪客 `cartonSwimmer11` 的底图与换色遮罩，未覆盖其他角色。

## 身份与制作约束

源 `tripo_convert_3e3a79de-ba19-4c94-98e0-2bd56290da81.glb` 的UV和原JPEG与旧11逐字节一致。源SHA256为 `8e76ef8e472555b4e8d2507df1fc99497b1885af2e0ec2e8d7c4485c9e198daf`。

旧运行模型已修正左肘与蒙皮权重，不能用源整包覆盖。按项目贴图精修与动作技能保留运行所有非图像缓冲、UV、法线、权重、骨架和关节枢轴，保持3892顶点、5611三角、41骨、单网格单材质。

内置ImageGen提供原位UV候选，经局部颜色/空间约束回贴。保留蓝发、荧绿发带、黑短裤、白滚边、橙白拉链与水壶细节。独立复核否决了v1后脑局部变黑的问题；v2恢复源蓝发，遮罩排除瓶盖噪点。未整体抹平材质或删除图案。

## 交付与备份

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| `tools/characters/3e3a79de_cleanup/Character_FineRefined_v2.glb` | 3008488 | `b3484e95cbbd36d1dba3dbc2aa5d401c290b5411db12ad5a7e7dc4634726cdc7` |
| `assets/race/models/CartonSwimmer11.glb` | 476276 | `74e9a5e9970704c2edaeeabdb7a9337822a3e15d1549ed1ec1031ecc4d47635c` |
| `assets/race/models/CartonSwimmer11ColorMask.png` | 66628 | `c6852d2e1527f49bfdf01e53e75aa109bc053270a3940ff0d531a045707e2da4` |

运行底图为512 JPEG q98、4:4:4渐进，225694字节，SHA `4e79a509e8b25419838d58199400812da67f099bebd5bea873088cd2006740c0`。源精修2048，未提高运行512分辨率或原512KiB模型上限。模型加遮罩从439484增加到542904字节，增加103420字节。

旧GLB、遮罩、两个meta在 `tools/characters/3e3a79de_cleanup/runtime-import/backup-before-replacement/`；桌面原件未动。旧运行SHA `673552cce6cbc165d7107896b3f9d7107b47b8abf331f1ceb17753a42e20b046`。

## 检查结果

- 97个原UV岛，无越界和退化UV面；本轮不重新展开UV。
- 真GLB内嵌JPEG重新导入，12机位离线核验；原色、五色及原/深肤色对照。R重建，G/B/A逐字节保留，旧运行UV最大差0。
- 235个生产语义动作样本的新旧蒙皮、肩肘腕与左右手序差为0。动作范围为蛙泳肢体、入水预备和挥手，不代表完整游戏控制器实测。
- 串行安装仅写GLB和mask。期间另一任务新增的头像映射经哈希证明是唯一额外配置变化，完整保留；记录在 `scope-check.json`，没有回退并行修改。
- 主UUID `8007929e-fd0d-4958-87ac-e8ab5f248821`、mask UUID `b727842e-a058-4afb-b5cf-3f238ed74cbb`及子UUID保留。
- Creator真实library图像、mask、mesh、skin、材质和预制体对应当前候选；逆绑定与关节位置误差0，关节旋转误差约0.000003415度；ASTC6x6及fallback策略对应，mip关闭。

报告在 `tools/characters/3e3a79de_cleanup/runtime-import/`。未启动/重启Creator、未截图编辑器、未手写library。

## 验证边界

512运行版的白滚边、拉链、瓶盖及细发带相对2048源版仍较软，极近景不是无锯齿承诺。保留源低频皮肤与固有低模切面。未验证微信iOS/Android ASTC画面、完整自由泳/动态过渡及接地IK。制作候选位于被忽略的tools目录，不等于已上传或Git提交。
