# 逐浪少女（5c5e）精修接入

2026-09-06，依据用户批量精修并自动替换授权，将5c5e源精修外观接入逐浪少女 `cartonSwimmer5`。

源文件 `tripo_convert_5c5e1d58-15e6-4e10-bf50-2b5042c3ca95.glb`，SHA256 `256781b2408dcc06ae257ad8a3221cbbf4b73420bc9e4fdcf735e926c9f4e73c`。按同序16014三角角点确认身份，朝向对齐后位置误差小于3.326e-7、权重误差小于5.96e-8。源原UV有917岛；运行已重排UV，不能整源覆盖。

依据贴图精修与动作技能，由内置ImageGen提供原UV候选，回贴保留深蓝短发、白框绿镜片、黑领白衣、白裤两侧黑片、绿裤脚、黑袜黑鞋带与腕表屏幕/表框。镜片只覆盖独立108面部件，不把头发/脸部并入换色。源底图2048离线转贴至原运行UV，运行始终512。

## 文件与成本

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| `tools/characters/5c5e1d58_cleanup/Character_FineRefined_v1.glb` | 3991292 | `92a6f776955b2f20f5591d1004280e8f95582980baba0bae22125306c4282782` |
| `assets/race/models/CartonSwimmer5.glb` | 506328 | `97943a70de1801e1a752a0fbaa1f85abc37226c6bc9166dff48539cec8224945` |
| `assets/race/models/CartonSwimmer5ColorMask.png` | 87836 | `badaee7cdc1696055893b27cfc5103211d65d256d1bcfb7b711b9326082eec95` |

运行内嵌JPEG q96、4:4:4渐进，196741字节，SHA `be71f92bf0ddff465ee087e0d58c4f21c42bc9c98818de1daef08e342f709932`。模型和遮罩总计594164字节，比旧版增加80462字节；不提高512KiB旧模型测试上限。源6834顶点，运行5060顶点，均5338三角/41骨。

所有运行非图像缓冲、UV、骨架、关节、权重、法线不变，仍单网格单材质；mask仅更新R，G/B/A逐字节保留。旧模型、mask及meta在 `tools/characters/5c5e1d58_cleanup/runtime-import/backup-before-replacement/`，旧模型SHA `36e88082d31a447ed3140faf489bdae5901d24e3c6011b8d6d21e39414895975`。桌面原件未动。

## 已验收与边界

- 真GLB重导入13视图与外部最终JPEG渲染逐像素一致，原色/五色/深肤已离线核验。
- 235个蛙泳肢体、入水预备与挥手样本新旧变形差0；查看动作对照未见新增肩肘/左右手错误。
- 串行快照与安装后85项范围检查通过，仅5的模型与mask改变，原meta保留。
- 主UUID `8b36f4bc-c8bc-4738-916c-05f25ac8bbad`，mask UUID `166caedf-551c-4462-8a60-33f1c89b8a7c`。Creator真实导入结果以 `runtime-import/cocos-import-5.json` 为准，未手写library。

512版领边、腕表小部件与鞋带仍较软，黑色镜片/鞋带附近有极细绿边；更弱R候选出现大片漏绿已拒绝。旧B鼻梁附近浅边保留，未冒称肤色全部重画。未做微信真机ASTC与完整游戏接地IK验收。

详细提示词、制作过程和审计在 `tools/characters/5c5e1d58_cleanup/`；tools被忽略，不等于已上传或提交。
