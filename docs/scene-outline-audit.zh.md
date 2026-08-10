# 场景描边审计

更新时间：2026-08-10

本文区分四类容易混淆的视觉处理：

1. 反向外壳：复制原 Mesh，沿法线外扩，剔除正面。
2. 显式结构线：从硬边生成贴面色带。
3. 材质轮廓增强：Fresnel 亮边，不增加几何。
4. UI 描边：LabelOutline 或 Graphics stroke，不属于 3D 场景描边。

## 当前启用的 3D 描边

| 对象 | 运行时节点 | 技术 | 创建入口 | 几何 / 提交成本 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 所有泳者 | `CharacterOutlineShell` | 蒙皮反向外壳，使用 `PlayerOutline.effect` | `CharacterSkinApplier.configureOutlineShells()` | 每个角色复制约 2,826-3,082 个蒙皮三角形；当前四个生产模型均为 1 个 skinned primitive，通常每角色增加 1 draw call | 玩家和 AI 当前均显式开启；底层开关已生效 |
| 泳池白色池沿 | `PoolEdgeOutlineLines` | 从 4 个池沿长方体的顶部与竖向中段硬边生成双面贴面色带，排除底边 | `GameManager.buildPool3D()` -> `applyPoolEdgeToonOutline()` | 128 triangles，1 draw call | 启用；不再使用反向外壳 |
| 场馆建筑结构线 | `VenueStructureEdgeLines` | 从 `StandStructure_Merged` 全部硬边和 Access 非楼梯混凝土硬边生成双面贴面色带；楼梯继续使用逐级专用提取，另补 2 条穿插式天花板墙交界 | `GameManager.buildPool3D()` -> `applyStandStructureToonOutline()` | 3,554 triangles，1 draw call | 启用；覆盖墙体、二楼/三楼楼板、天花板、平台、Access 墙与门楣；明确排除普通看台、角看台、座椅、扶手、门、标识、泳池和池沿 |

建筑通用提取实际命中 364 条硬边、1,352 triangles；与入口楼梯 2,194 triangles 和 2 条接触线 8 triangles 合并为一个 Mesh。场馆描边连同池沿合计约 3,682 triangles、2 draw calls。全部只在场馆加载时构建一次，比赛帧内没有 JavaScript 更新或 Mesh 重建。

### 共用描边 Effect

`assets/race/effects/PlayerOutline.effect` 当前只服务于角色反向外壳。

该 Effect 使用 front-face culling、法线外扩和 depth bias。它适合闭合且法线可靠的模型，不适合整块复杂建筑合批 Mesh。

泳池池沿和场馆结构线均使用 `builtin-unlit` 双面黑色色带，不再加载该 Effect。

## 材质轮廓增强

`SwimmerDynamicColor.effect` 包含两种看起来像描边、但不增加 Mesh 或 draw call 的效果：

- 常态 Fresnel rim light：角色轮廓附近的蓝色亮边，默认开启。
- 跳水蓄力 inner glow：蓄力时启用；同时关闭常态 rim，避免两层亮边叠加。

这两项属于角色材质内部计算，不是黑色几何描边。

## 容易误认为描边、实际不是

| 对象 / 系统 | 实际用途 |
| --- | --- |
| `applySeatSideTone()` / `BleacherSeatSideToneOverlay` | 座椅侧面深蓝色调，1 个额外静态 draw call，不是轮廓线 |
| `StandHeightShade` | 看台和墙体按高度、距离渐暗，不是描边 |
| `ToonProp.effect` | 起跳台等静态道具的 cel-shading 明暗分层，不是描边 |
| `lane_floor_line_batch` | GLB 内建泳道地面标线，是模型本体 |
| `BleacherAccess_Rails_Merged` | GLB 内建扶手几何，深色材质，不是描边系统 |
| `pool_edge_batch` | GLB 内建白色池沿本体；黑边来自运行时 `PoolEdgeOutlineLines` |

## 遗留与已移除方案

| 项目 | 当前状态 | 说明 |
| --- | --- | --- |
| `VenueTierFoldLines` | Blender 中隐藏且 `hide_render=true`；不在最终 GLB | 旧的手工折线辅助 Mesh，24 vertices / 18 faces |
| `VenueAccessStairEdgeShell` | 当前源码已移除 | 旧 Access 整块反向外壳，曾包含楼梯、墙和门楣；会导致白墙斜纹闪烁，斜视时楼梯也只出现一侧轮廓 |
| `VenueTierEdgeShell` | 当前源码已移除 | 旧普通看台台阶反向外壳，2,828 triangles / 1 draw call；按当前视觉要求已停用 |
| `PoolEdgeOutlineShell` | 当前源码已移除 | 旧池沿反向外壳；已换成排除底边的 128 triangles `PoolEdgeOutlineLines` 双面贴面色带 |
| `StandStructure_Merged` 反向外壳 | 当前筛选已排除 | 旧整墙 / 平台外壳是竖直白墙闪烁的主因 |
| 入口楼梯完整方柱线 | 当前源码已移除 | 曾为 825 根方柱、9,900 triangles；已换成 2,194 triangles 的贴面色带 |

## 已发现的问题

### 1. `playerOutline` 开关已修复

比赛创建时玩家和 AI 均显式传 `true`。准备页、姿势预览和模型调试也传 `true`。

`configureOutlineShells()` 现在会检查 `options.playerOutline`：为 `false` 时跳过创建，并销毁已经存在的 `CharacterOutlineShell`。后续决定关闭某类 AI 或远端角色描边时，只需让对应调用传 `false`。

### 2. 当前微信构建产物落后于源码

`build/wechatgame/assets/start-scene/index.js` 时间为 2026-08-09，当前描边源码时间为 2026-08-10。该构建仍包含旧 `PoolEdgeOutlineShell` 和角色壳，不包含：

- `PoolEdgeOutlineLines`；
- `VenueStructureEdgeLines`。

因此现有 `build/wechatgame` 不能用于验证本次场馆描边调整。真机测试前必须重新构建微信小游戏。

## UI 描边（单独统计）

UI 描边不属于 3D 场景 Mesh，主要有：

- `SpeedStarsUI.prefab`：实际启用 3 个 Label 内建描边，节点为 `Logo`、`DistanceModeLabel`、`SwimLogo`；其余 `_enableOutline=false` 不计入。
- `SpeedStarsUiPrefabBuilder`：冲刺文字使用一个 `LabelOutline`。
- `SwimmerNameOverlay`：每个 AI 名称标签使用 Label 内建描边。
- `UIController`：结束倒计时数字和提示各使用一个 `LabelOutline`。
- `GameManager`：头顶速度读数使用 Label 内建描边。
- `PrepareRaceFlow`：准备页标题使用一个 `LabelOutline`。
- `makeOutlineButton()`、`makeRoundedRect()` 及若干面板使用 `Graphics.stroke()` 绘制 UI 边框；这是控件边框，不是 3D 描边。

UI 描边应继续遵守竞速 HUD 性能规则：静态内容只构建一次，动态 Graphics 不得每帧 clear + redraw。

## 建议整理顺序

1. 重建微信小游戏，再做一次真机视觉与 GPU frame time 验证。
2. 后续按比赛模式、设备档位或远端距离决定哪些角色传 `playerOutline=false`。
3. 观察池沿、入口楼梯、二楼地面、天花板墙交界和 Access 墙地接触色带的宽度及表面偏移；建筑类继续优先使用显式硬边色带。
4. 确认不再需要后，从 Blender 源文件删除隐藏的 `VenueTierFoldLines`，避免以后误判为线上方案。