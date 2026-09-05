# 破浪机甲（06de）新增接入

2026-09-06，用户明确说明本批其中机甲为新增角色，并授权精修后自动接入。使用新稳定ID `cartonSwimmer15`，不覆盖任何已有角色。名称暂取“破浪机甲”，沿用现有均衡属性和默认解锁；这是已向用户说明的工作默认值，不代表用户已单独确认名称或数值。

## 身份、结构与精修

源 `tripo_convert_06de2884-ad0a-431a-b05b-3c96102771f1.glb`，631800字节，SHA256 `3a6012ef7978dfc9192a6b5c322a5038bb785bb6bcc79e9d5b252e4b89bdd12f`。保留白甲、青柠绿甲、蓝色灯条/踝环及深蓝关节，内置ImageGen候选经原UV及3D表面限定合成；v2射线定位踝内杂绿并补回深色材质，胸蓝条边仅修R覆盖，不把噪点都当装备。

保留7685顶点、5386三角、41骨、单网格单材质及原UV/拓扑/权重/关节枢轴。位置相同的多组点存在不同权重/法线，未强行焊接。原UV有一个极小退化面位于脚底，未借精修改拓扑。

按项目动作技能，将骨轴规范为标准T-pose局部旋转，保留角色自身比例并重算逆绑定。21组共享动作3661样本的朝向最大误差小于0.000283度，按自身枢轴重定向的蒙皮最大误差小于1.824e-6。另按生产语义235样本核验；v2相对已验证v1的蒙皮/骨矩阵差0。不是与其他人物几何零差，也不代表完整游戏接地IK通过。

最终运行场景标签从Mecha06de规范为Scene，仅JSON标签变化，所有BIN、nodes/skins不变；记录了实际渲染前SHA和最终SHA，未假称重渲。最终Scene版再导入检查通过。

## 文件与预算

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| `tools/characters/06de2884_cleanup/v2/Mecha06de_FineRefined_v2.glb` | 5170700 | `28a17222149e3c11e79dd952026295ef6cf3e515dd1df7f0b26b18e5fc2f339c` |
| `assets/race/models/CartonSwimmer15.glb` | 647080 | `62b0ef81a058f1e4e11c7dd6558238510f781a0353e2aabc792467ff985c5075` |
| `assets/race/models/CartonSwimmer15ColorMask.png` | 48846 | `0d86fda81b052b751b064e5f39d6be36aefadcf4665fda5fe9e522cc2b89253c` |
| `assets/race/ui/character-v1/portrait-cartonSwimmer15.png` | 161925 | `569bf1ce486b517ba3a577b1860f2d5d8d6ee59cec8fd26ead172ba726a94564` |

源2048仅留制作目录。运行512 JPEG q95/4:4:4渐进，底图SHA `18cc89869e859d35eb2afe1018c8dbfe2743e61293f839862cc7ac285e7256eb`；mask512 RGBA，R只控制原绿甲、G/B=0、A=255。新GLB+mask共695926字节，加320不透明卡面总857851字节，不含Creator派生/ASTC与fallback构建产物。新增角色单独设768KiB模型测试上限，未提高任何旧角色阈值。

卡面由内置ImageGen按本机甲身份与项目现有卡面风格制作，缩为320×320；无烘焙文字。原图、提示词及缩图脚本在制作目录。桌面原模型、v1和其它角色均未覆盖。

## 接入和联机

- `PlayerCharacterConfig.ts`新增15，首选仍跃浪少女6；不加新技能逻辑，数值沿用均衡模板。
- `ResourcePaths.ts`集中模型、mask和卡面路径，共用`model-actions/tPose`与`Tpose_divePrep`，没有复制动作目录。
- `supportsSkinTone:false`且mask G/B为0，白甲/深色关节/蓝灯不当肤色。未拆材质、未新增shader、未增加每帧逻辑。
- 新角色表是联机共享语义，协议升至13，拒绝11/12旧表混跑；原单人玩法与默认选择不变。既有联网头像固定映射未改为游戏角色选择。

## 检查与尚待项

五色47图、原色/柔光与动作近景离线核验；主要胸条/踝内杂绿已处理。512近景仍有极细过渡像素，原脚底极小退化UV保留。离线检查不包括完整自由泳、动态状态过渡、场馆接地IK或微信真机ASTC。

2026-09-06 01:08，本批26项角色/协议测试、18项房间测试及TypeScript5.4.5检查通过。字体按生成流程同步，1237字检查通过。

运行文件和接入代码已落盘，**本记录写入时Creator尚未生成15的meta**；不能把文件复制等同引擎导入完成。需现有Creator窗口扫描后运行纹理策略修复、核对真实library及预制体路径。不得手写meta/UUID或伪造library。完成情况见 `tools/characters/06de2884_cleanup/runtime-import/cocos-import-15.json`；总状态见 `tools/characters/batch-20260906/batch-audit.json`。
