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

目前接入：运动员1（`swimmer0621_2`）、潜水员（`diver`）和高达（`gundam`）。角色列表固定预留 20 个槽位，未配置或未解锁的槽位显示为锁定状态。

## 外观与比赛交接

`PLAYER_SKIN_TONES` 定义白、黄、黑三种肤色；`PLAYER_COLOR_SCHEMES` 定义非皮肤部位的配色。默认值为“黄”肤色和“原始”配色：两者都不覆盖模型导入时的材质颜色，与角色选择功能加入前的比赛主角一致。角色页的小按钮循环切换这两项；只有切换到非原始选项时，才按对应通道覆盖材质。正式比赛由 `SwimmerFactory` 读取同一份选择并应用到玩家模型。赛事页将选择写入既有 `GameBalance` 难度状态。

## 背景资源

静态 low-poly 更衣室背景位于 `assets/resources/ui/prepare-race/locker-room-lowpoly-bg.png`，资源路径集中在 `ResourcePaths.ts`。它用于当前功能版的角色页背景，后续可替换为真正的 3D 更衣室场景，而无需改动选择流程。
