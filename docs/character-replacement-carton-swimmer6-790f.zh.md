# 跃浪少女（790f）精修接入

2026-09-06，按用户授权精修后自动接入，只替换跃浪少女 `cartonSwimmer6` 的外观。

## 身份与保真

源为 `tripo_convert_790f398d-1d56-4067-a80e-fdb7a9a37d4c.glb`，SHA256 `d81ff0c57ce8fbced41fc0d158f76b881b013cdfb6f246f590d3f4c1cdba2c0c`。同序17115三角角点确认身份，位置误差小于1.803e-6。原943UV岛、7154顶点；旧运行已重排为5693顶点，均5705三角、41骨。

按项目贴图精修、UV和动作技能：源原UV清理后2048离线转贴至旧运行UV，维持单网格、单材质、512底图与mask；全部非图像缓冲、关节枢轴、骨轴、权重、法线和UV不变。重建R装备覆盖，旧G/B/A逐字节保留。

v1独立复核发现兜帽U形缝和腕带框扣被过度抹平，未安装。v2按射线对应原图恢复真缝与框扣；局部处理白袜绿三角/细线、黑裤白短线和丸子头孤立绿三角，保留棕发束、粉镜片、粉饰带、叶片/柑橘配件与鞋面设计。

## 文件与成本

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| `tools/characters/790f398d_cleanup/Character_FineRefined_v2.glb` | 3184828 | `3fffbf47ff55863b883a1bba154d653f314bd9c9d3261256d9a229636047f15f` |
| `assets/race/models/CartonSwimmer6.glb` | 538672 | `08436c136d48f73baca7b6388757e3393cabaed900a284f26b13268515cda456` |
| `assets/race/models/CartonSwimmer6ColorMask.png` | 90888 | `07f2a8f5fbcdcf7889e9d4bbef266f828c20b3a86bc4e322e766f94936735e3b` |

运行底图512 JPEG q95/4:4:4渐进，193800字节，SHA `981106a4f0cfb2e74a17821dc005c36b72bf30b855e72e375ec520f30ebb5880`。模型+mask总629560字节，比旧版549949增加79611字节。6原测试没有512KiB模型上限，本轮未新加或提高旧测试阈值，运行分辨率和几何预算不变。

旧模型、mask和两份meta备份在 `tools/characters/790f398d_cleanup/runtime-import/backup-before-replacement/`，桌面源与v1候选未覆盖。旧运行SHA `ebb501207cd9ec8036c434378b6b1b4871e6a62a199ec299dcb2a70a2b0bdcd9`。

## 验证

- 原色、五色、原肤/深肤离线回贴；真GLB重导入12视图与最终外置JPEG逐像素一致。
- 235个蛙泳肢体、入水预备与挥手样本新旧蒙皮和左右手序差0；查看动作图无新增反手/肩肘回归。
- 串行安装85项范围核验仅模型和mask变动。主UUID `a67993c4-5f32-4ba5-97ea-fd6d3710232e`、mask UUID `06f4e112-3493-49ab-a051-be0a37f65ade`及所有子UUID保留。
- Creator真实导入以 `runtime-import/cocos-import-6.json` 为准，未手写缓存。

源与原色可见U缝/框扣；现有近纯色换色公式会压低同色区域内部的缝线、叶脉与柑橘细纹对比，本轮未修改共享shader。512极近景仍有软边和少量混合像素，不承诺消除全部锯齿。没有微信真机ASTC、完整自由泳/过渡/接地IK验收。

完整制作提示与报告在 `tools/characters/790f398d_cleanup/`，tools为忽略目录，不等于已上传或提交。
