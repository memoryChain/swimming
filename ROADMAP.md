# Speed Swimming 3D Roadmap

本文档记录当前项目实现状态和后续计划。内容以代码为准，尤其是 `assets/scripts/core/GameManager.ts`、`assets/scripts/venue/*`、`assets/scripts/entity/*` 和 `assets/scripts/core/ResourcePaths.ts`。

## 当前定位

`Speed Swimming 3D` 是一个面向微信小游戏的轻量 3D 游泳节奏竞速原型。玩家通过全屏点击/按住输入触发左右交替划水，系统根据长按稳定性、左右交替质量、动作队列和水中阻力推进速度。

当前比赛场景是 50m 标准泳池，默认比赛距离为 100m，可选 100m / 200m / 500m，长距离通过 50m 泳池内折返完成。运行时包含 8 条泳道、低模泳馆、透明水面、玩家、AI 对手、观众面片、动态镜头、HUD、模型调试模式和角色描边。

## 当前场景与资源

- 运行时泳池入口集中在 `RESOURCE_PATHS.poolPrefab = 'pool/PoolScene'`，也就是 `assets/resources/pool/PoolScene.prefab`。当前 prefab 内嵌的是 `assets/resources/pool/LowPolyPool.glb` 导入出的 `LowPolyPool` prefab。
- 泳馆权威源文件统一为 `sceneresource/LowPolyPool.blend`。正常运行路径应加载 `PoolScene.prefab`，不要在运行时代码里再拼出另一套泳池；`PoolFallbackBuilder` 只作为 prefab 加载失败时的线框降级方案。
- Blender 源文件、预览图、备份文件只保留在 `sceneresource/`，不放进 `assets/` 发布资源目录。
- 当前 prefab 中应保留可手调的 `RaceCourseStartMarker` 和 `RaceCourseFinishMarker`，代码会优先用它们校准泳池内部起点和终点。
- 水面节点使用 `PoolWaterSurface`。旧的 `PoolWater_0_50` / `PoolWater_50_100` 会被 `WaterSurfaceBinder` 禁用，`flat_transparent_water_plane` 不应再作为当前水面参与渲染。
- 水面材质路径为 `pool/RagingPoolWater`，由 `WaterSurfaceBinder` 绑定；`WaterSurface` 组件负责轻量水面动画。
- `RuntimeSceneBuilder` 会应用标准天空盒，默认取 `DEFAULT_SKYBOX_VARIANT`。当前代码默认是 `coldNight`，但实际发布资源目录里主要有 `ColdNight` 和 `EpicBlueSunset`，新增天空盒时要同步 `ResourcePaths.ts` 和 `assets/resources/skybox`。
- 运行时代码已经不再动态生成天花板。后续如果重新加入天花板节点，需要在节点名中包含 `ceiling`，方便俯视镜头继续隐藏。

## 加载顺序

当前启动流程由 `GameManager.buildScene()` 编排：

1. `RuntimeSceneBuilder` 先创建基础世界节点、相机和 UI Canvas。
2. `RuntimeSceneBuilder` 同时绑定 `StandardSkyboxApplier` 并应用默认天空盒。
3. `VenueManager` 加载 `PoolScene.prefab`，并绑定水面材质；加载失败时才使用 `PoolFallbackBuilder` 的线框泳池。
4. 泳池加载完成后一帧，`RaceCourseLayout.calibrateFromPoolScene()` 根据泳池节点校准赛道。
5. 观众面片在泳池加载和赛道校准之后创建。
6. 玩家、AI、UI、`RaceManager`、输入路由和流程控制器最后创建。

这个顺序是为了保证人物起点、入水点、观众位置、镜头和名次牌都能读到当前泳池场景，而不是读旧的默认坐标。

## 赛道与人物位置

- 默认泳池定义在 `assets/scripts/venue/VenueConfig.ts`：8 条泳道，泳道宽 `2.625m`，赛道长度 `50m`。
- `RaceCourseLayout` 是泳池坐标映射的唯一入口，负责起点、终点、折返点、平台站位、入水点、水面高度和角色游泳高度。
- 代码优先读取 prefab 中的 `RaceCourseStartMarker` / `RaceCourseFinishMarker` 作为泳池内部边界，再通过 `SWIMMER_FRONT_BOUNDARY_CLEARANCE` 把角色根节点向池内偏移，避免手部越过池壁。
- 如果 marker 缺失，代码会退回到水面或池底 mesh 的 bounds，再退回到 `DEFAULT_POOL_DEFINITION`。
- 角色站上跳台时使用 `start_block_top_near` 的 bounds 计算平台高度，并额外加 `PLATFORM_STANDING_LIFT`，避免脚陷入跳台。
- 游泳高度目前保留 `swimY = 0`，水面高度只作为水面和水花参考，避免角色因为水面 bounds 被抬到水上方。
- `Swimmer.prepareDive()` 使用平台位置，`performDive()` 使用入水位置，`applyCoursePosition()` 使用 `RaceCourseLayout.distanceToWorldX()` 映射比赛距离。
- 完赛后的漂浮位置会向池内小幅收回，并通过 `clampSwimWorldX()` 限制在泳池游泳区间内。

## 比赛距离逻辑

- `GameBalance.ts` 中 `RACE_COURSE_LENGTH = 50`。
- `RACE_DISTANCE_OPTIONS = [100, 200, 500]`，默认 `RACE_DISTANCE = 100`。
- `RaceManager` / `SwimmerMotor` 仍按累计游进距离判断完赛，50m 池内折返由 `RaceCourseLayout` 负责映射到世界坐标。
- 后续如果泳池长度变化，优先改 prefab marker 和 `DEFAULT_POOL_DEFINITION`，不要在人物或镜头代码里写死新坐标。

## 观众

- `SpectatorCrowdBuilder` 在泳池加载完成后执行。
- 当前优先扫描实际泳馆里的弧形看台行，节点名或 mesh 名包含 `lower_bowl_continuous_row` / `upper_bowl_continuous_row` 时会作为观众落点来源。
- 如果扫描不到看台行，才使用备用椭圆环绕布局。
- 观众数量通过 `SPECTATOR_DENSITY_SCALE = 0.1` 控制，优先用低密度合批面片保护微信小游戏性能。
- 观众面片有颜色分组、行列随机缺口、角度/深度/高度扰动和轻微 wobble，避免过于整齐。
- 观众是低成本合批 mesh 面片，不应改成大量独立模型。

## 名次牌

- 名次牌由 `FinishRankMarkerBuilder` 创建。
- 当前名次牌不再放在终点池边，而是放到每条泳道对应的起跳台上方。
- 位置通过 `RaceCourseLayout.platformPosition(result.swimmer.node.position.z)` 计算，Y 方向额外使用 `RANK_MARKER_PLATFORM_Y_OFFSET` 抬高。

## 角色与模型

- `CartoonSwimmerRig.ts` 使用统一常量 `SWIMMER_MODEL_SCALE = 1.35`，比赛、赛前站立、完赛漂浮和模型调试都使用同一个缩放值。
- 角色 prefab 候选路径集中在 `ResourcePaths.ts`。代码里仍保留 `models/UserSwimmerLow` 作为默认候选，同时注册了 `newMan01`、`swimmer04` 和 `swimmer04Original` 变体；当前 `assets/resources/models` 中实际存在的是 `UserSwimmer04.glb` 和 `UserSwimmer04Original.glb`，后续需要让默认候选和实际导入资源保持一致。
- 运行时换色、描边、完美输入闪光、水花、模型变体切换、天空盒切换和手动自由泳姿态都由角色/模型调试相关模块负责。
- `MOTION_TUNING.animationSpeedScale` 同时影响比赛和 debug model。

## 输入与运动规则

- 移动端比赛输入是全屏 tap/hold，`InputRouter` 会自动在 `LEFT` / `RIGHT` stroke 之间交替。
- 不显示左右触摸区域；键盘 `A` / `D` 继续用于编辑器和调试。
- 动作队列只保留当前动作和一个待执行输入，避免提前堆满队列仍持续拿满收益。
- 稳定性评分基于每轮长按比例、最近窗口标准差、有效比例范围和输入新鲜度。
- 加速由基础动作加速、稳定性加速、左右交替质量、水阻、池内固定减速和 perfect combo 奖励共同决定。

## 调参和调试

- Debug model 入口在开始页 `MODEL DEBUG`。
- 调参面板定义在 `TuningDebugControls.ts`，保存文件为 `assets/resources/config/tuning.json`。
- Debug model HUD 当前支持模型变体切换、天空盒切换、动作速度调节，并显示稳定性、输入新鲜度、加速度和速度。
- 新增会影响比赛手感的参数时，需要接入调参面板并使用稳定英文 id，例如 `speed.strokeBaseAccel`。
- 比赛 HUD 当前显示评级/combo、速度、倒计时/完赛提示和竖向长按节奏提示。

## 模块边界

```text
core/
  GameManager.ts          # 启动和运行时编排入口
  GameBalance.ts          # 比赛距离、速度、跳水、AI 等核心数值
  InputRouter.ts          # 键盘、鼠标、触摸和自动交替输入路由
  InputTuning.ts          # 输入、稳定性和动作速度调参默认值
  ResourcePaths.ts        # resources 路径集中配置
  TuningDebugControls.ts  # 调参定义、保存和加载

app/
  RuntimeSceneBuilder.ts  # 运行时世界、相机、灯光和天空盒初始化
  StandardSkyboxApplier.ts# 标准天空盒加载和切换
  GameFlowController.ts   # 开始、重开、倒计时和比赛流程
  ModelDebugFlowController.ts # 模型调试流程、镜头、模型/天空盒切换

venue/
  VenueConfig.ts          # 默认泳池定义
  RaceCourseLayout.ts     # 泳池坐标、折返、起跳台和水面校准
  VenueManager.ts         # 泳池 prefab 加载入口
  PoolSceneLoader.ts      # resources prefab 加载
  PoolFallbackBuilder.ts  # prefab 加载失败时的线框降级泳池
  VenueVisualEnhancer.ts  # 泳馆材质提亮和旧遮挡节点处理
  WaterSurfaceBinder.ts   # 水面节点和水面材质绑定
  SpectatorCrowdBuilder.ts# 观众面片生成
  FinishRankMarkerBuilder.ts # 名次牌生成

entity/
  Swimmer.ts              # 角色门面，连接 motor、赛道和表现层
  CartoonSwimmerRig.ts    # 当前低模角色表现、姿态、水花和缩放
  AISwimmerController.ts  # AI 输入节奏

swimmer/
  SwimmerMotor.ts         # 比赛距离、动作队列、速度和评分结果
  SwimPhysicsModel.ts     # 速度、阻力和 AI 推进
  StrokeMetrics.ts        # 划水指标类型

competitor/
  CompetitorManager.ts    # 玩家和 AI 创建
  CompetitorConfig.ts     # AI 和泳道视觉配置
  SwimmerFactory.ts       # 玩家和 AI swimmer 节点/rig 创建

camera/
  RaceCameraDirector.ts   # 比赛镜头、广播镜头和自由镜头

ui/
  DebugPanelBuilder.ts
  RuntimeUiFactory.ts
  RaceHudBuilder.ts
  StartScreenBuilder.ts
  ModelDebugHudBuilder.ts
  UIController.ts
  UIFlowController.ts
```

## 近期计划

### 1. 性能基线

- 在调试面板增加 FPS、draw call、选手数量、描边开关和水面/水花开关状态。
- 增加轻量 `PerformanceMode` 配置，用于控制描边、水面动画、水花、AI 数量和镜头模式。
- 微信小游戏发布前默认关闭高频 debug log，并保留能解释帧率状态的必要日志。
- 清理或降级 `CartoonSwimmerRig`、`SplashEmitter`、`StandardSkyboxApplier` 等模块里的高频 `console.log`，避免真机预览时日志本身拖慢帧率。

### 2. 角色渲染和描边优化

- 把 `CartoonSwimmerRig.build()` 的多个布尔/颜色参数整理成明确参数对象。
- 修正 `ResourcePaths.ts` 的默认角色候选，使默认模型指向当前实际存在的轻量资源，或补回缺失的 `UserSwimmerLow` prefab。
- 支持描边分级：不描边、只主角、全部细描边、全部当前描边。
- 复用描边材质或 effect，避免角色数量增加时产生过多材质实例。

### 3. 手感调参

- 继续用 debug model 验证长按稳定性、动作速度、阻力和 combo 奖励。
- 增加参数导入/导出文本，方便多端或多人协作调参。
- 新增手感参数必须进入 `TuningDebugControls.ts` 并支持 `tuning.json` 覆盖。

### 4. 比赛反馈

- 增加进度条或泳道小地图，显示玩家和主要 AI 的相对位置。
- 完赛面板展示完赛时间、名次、最大 combo、平均速度、Perfect/Good/Bad 次数。
- 小屏 HUD 不应遮挡角色、泳道和节奏输入反馈。

### 5. 低模资源管线

- 保持 Blender 源文件在 `sceneresource/`，运行时只加载 `assets/resources` 下的 prefab、glb、材质和 effect。
- 后续从 `sceneresource/LowPolyPool.blend` 导出泳馆后，检查 `PoolScene.prefab` 中 marker、水面、看台行和跳台节点名是否仍可被代码识别。
- `sceneresource/` 里当前没有 `build-lowpoly-pool.py`，如果继续依赖 Blender 自动导出，需要补回脚本或在文档里记录新的手动导出步骤。
- 避免把 `.blend1`、预览图、备份 glb 等开发产物加入发布资源。

## 中长期计划

- 增加练习模式，只显示节奏、速度曲线和划水反馈。
- 扩展 AI 难度：Easy / Normal / Hard，保持轻微随机失误，避免匀速滑行感。
- 增加本地最佳成绩和后续微信好友榜接入。
- 优化自由泳动作曲线，在不显著增加面数的前提下提升手入水、抱水、推水、出水和打腿可信度。
- 为核心逻辑补充轻量测试或脚本校验，优先覆盖 `RaceCourseLayout`、`SwimmerMotor`、稳定性评分和 AI 输入节奏。

## 验收基线

- 项目能在 Cocos Creator 3.8.8 打开并运行主比赛场景。
- 主场景从 `PoolScene.prefab` 加载泳馆，不叠加旧泳池，不额外生成无关场馆物件；只有 prefab 加载失败时才允许线框 fallback。
- 人物创建发生在泳池加载和赛道校准之后，赛前站在跳台上，入水和游泳高度跟当前泳池适配。
- 50m 折返和最终触边不应让角色手部明显越过泳池内部边界。
- 观众面片位于实际弧形看台上，不漂浮在空气或泳馆外。
- 水面使用 `PoolWaterSurface` 和 `pool/RagingPoolWater`，不遮盖泳道浮漂。
- 模型调试页的模型/天空盒切换应只暴露实际可加载资源，不能长期保留会失败的默认候选。
- TypeScript 轻量检查命令：

```powershell
npx.cmd --yes --package typescript tsc --noEmit --ignoreDeprecations 6.0 --skipLibCheck
```
