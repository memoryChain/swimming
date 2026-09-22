# 杂物漂流低模资产

本目录保存“杂物漂流大乱斗”的可复现 Blender 参考资产（原文件／模型 ID 保留）。F 已核对瓶身仅有色带、餐盒无不适合的文字标签，未重做资产；2026-09-22按用户最新反馈恢复看台方向高处抛入与接近平视镜头，规则见现有玩法说明。游戏运行时仍由 `LitterDebrisGeometry.ts` 生成共享顶点色网格，不加载贴图，也不在比赛中动态创建模型。

镜头独立审查：运行 `npx.cmd --yes --package typescript@5.4.5 -c "node scripts/review-litter-airborne.cjs"`，生成 `airborne-camera-review.html` 与 `airborne-camera-audit.json`。取自真实表现、相机和正式场馆建筑；简化水面，不是真机截图，未含正式水体、观众与落水粒子。HTML为可再生预览，不作为运行时资源。

## 四种轮廓

- `ClassicColaBottle`：经典可乐瓶，细颈、肩部、红色环绕标签和收底都由连续十边形截面形成。
- `CrushedWaterBottle`：压瘪矿泉水瓶，使用八边形椭圆截面和不对称中心偏移，轮廓更扁、更轻。
- `SportDrinkBottle`：短粗运动饮料瓶，宽肩、粗瓶盖和高对比色带形成近距离辨识度。
- `FoamMealTray`：闭合泡沫餐盒，具有切角外壳、抬高盒盖、四周压边、后侧铰链和少量污渍色块；不再使用零食袋轮廓。

四个模型共用一份顶点色材质、没有纹理。运行时三种瓶子共用硬杂物机制，泡沫餐盒共用可穿过、持续减速和受推漂移的软杂物机制。瓶子缩放为 `0.68`，餐盒缩放为 `0.88`，整体比旧模型更小。

## 制作约束

- 瓶身使用相连的椭圆截面，瓶盖、瓶颈、标签和瓶底之间没有悬空缝隙。
- 压瘪水瓶通过截面本身的不对称表现变形，不额外堆叠装饰碎片。
- 餐盒主体和盒盖均为闭合低模体，边框与铰链保持少量重叠，旋转时不露缝。
- 四份网格均使用硬边低多边形、单材质和顶点色，适合微信小游戏运行预算。

## 重建

配置 Blender 后，从项目根目录运行：

```powershell
python scripts/run-blender.py -- --python art/litter-debris/build_litter_debris.py
```

脚本会重建 `LitterDebris.blend`、导出 `LitterDebris.glb`，并写出 `litter-debris-audit.json`。这些文件用于源模型六向复核；游戏内网格仍由运行时代码按同组尺寸生成，避免额外 Prefab、贴图和异步加载。
