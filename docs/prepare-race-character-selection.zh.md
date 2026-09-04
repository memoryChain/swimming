# 准备比赛：角色与赛事选择

入口页的“准备比赛”会进入角色选择页；选择角色后点击“选择比赛”进入独立赛事页，选定难度并点击“开始比赛”才会加载正式比赛。

## 角色配置

玩家可选角色集中在 `assets/scripts/app/PlayerCharacterConfig.ts` 的 `PLAYER_CHARACTER_DEFINITIONS`。新增角色时添加一条定义即可，字段如下：

- `id`：稳定英文 ID。
- `name`：界面显示名。
- `modelVariantId`：`ResourcePaths.ts` 中已有模型变体 ID。
- `unlocked`：是否在角色列表中可点击。
- `stamina`、`technique`、`burst`：右侧面板显示的 0–100 属性。
- `description`、`skillName`、`skillDescription`：角色说明与技能文案。
- `robotStyle`：机械角色的材质风格开关（可选）。

目前只接入 `muscleMan`、`cartonSwimmer5`、`cartonSwimmer6`、`cartonSwimmer8`、`cartonSwimmer9` 和 `cartonSwimmer10`。角色列表固定预留 20 个槽位，未配置或未解锁的槽位显示为锁定状态。

## 外观与比赛交接

`PLAYER_SKIN_TONES` 定义原始暖肤色和深肤色；`PLAYER_COLOR_SCHEMES` 定义非皮肤部位的配色。暖肤色使用 `preserveOriginal` 保留模型导入时的皮肤，切换到深肤色后才按遮罩覆盖。角色页的小按钮循环切换肤色和服装配色，正式比赛由 `SwimmerFactory` 读取同一份选择并应用到玩家模型。赛事页将选择写入既有 `GameBalance` 难度状态。

新角色贴图统一用绿色标记可换色服装。导入时先保留原始贴图，再用 `scripts/generate-green-recolor-mask.py` 生成换色遮罩：红通道覆盖绿色服装，蓝通道覆盖皮肤，绿色通道保留给需要独立泳帽颜色的模型。在 `ResourcePaths.ts` 的模型变体中配置 `dynamicColor.mode: 'mask'` 与对应 `maskPath`。运行时分别替换服装色和肤色，同时保留原贴图明暗；头发、黑白服装和其他未遮罩区域不变。新角色不要接到旧模型使用的 `whiteKey` 模式。

## 背景资源

静态 low-poly 更衣室背景位于 `assets/resources/ui/prepare-race/locker-room-lowpoly-bg.png`，资源路径集中在 `ResourcePaths.ts`。它用于当前功能版的角色页背景，后续可替换为真正的 3D 更衣室场景，而无需改动选择流程。
