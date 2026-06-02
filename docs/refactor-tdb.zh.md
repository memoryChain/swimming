# SpeedSwimming 代码重构 TDB 中文说明

## 1. 背景

当前项目已经跑通了比赛核心闭环：倒计时、玩家/AI 划水输入、泳手移动、基础摄像机、运行时泳池搭建、HUD 和比赛结果展示。

后续功能会继续扩展：

- 支持不同泳池场景和场馆变化。
- 生成观众、丰富场馆氛围。
- 替换不同人物模型、皮肤、骨骼和动画。
- 增强比赛摄像机，包括多机位、自动切镜、动态 FOV。
- 增加入水/起跳动作。
- 增加完赛后的名次表现、结果展示、领奖台流程。
- 扩展更多 UI 页面和比赛阶段 UI。

所以这次重构的目标不是马上实现这些功能，而是先把代码边界整理清楚，让后续功能有明确落点。

## 2. 当前主要问题

### 2.1 `GameManager` 过于臃肿

现在的 `assets/scripts/core/GameManager.ts` 同时负责：

- 运行时场景搭建。
- 泳池加载和 fallback 泳池生成。
- 灯光、场馆、看台搭建。
- 泳手生成和 AI 配置。
- UI 创建。
- 比赛状态切换。
- 输入事件绑定。
- 摄像机模式、自动切镜、FOV。
- 模型 debug 模式。
- debug 面板和速度条绘制。

这会导致任何新功能都容易改到 `GameManager`，后续冲突和维护成本都会变高。

### 2.2 `Swimmer` 混合了规则、物理、动画和特效

现在的 `assets/scripts/entity/Swimmer.ts` 同时负责：

- 比赛生命周期。
- 速度、距离、疲劳值。
- 手/腿输入频率统计。
- 同步度、努力度计算。
- 速度物理公式。
- 调用 `RhythmEvaluator`。
- 简易节点动画。
- 3D 模型骨骼姿态 fallback。
- 调用 `CartoonSwimmerRig`。
- 水花触发。
- 终点 ragdoll tween。

这意味着修改速度规则、替换人物模型、调整动画效果都会碰同一个类，耦合太高。

### 2.3 `CartoonSwimmerRig` 职责太多

现在的 `assets/scripts/entity/CartoonSwimmerRig.ts` 同时负责：

- 模型 prefab 加载。
- 骨骼节点查找。
- 材质和贴图生成。
- 描边壳配置。
- 自由泳骨骼姿态。
- 水花节点创建和更新。
- 赛前站立姿态。
- 模型 debug 模式。

后续如果换模型，不应该继承这一整套实现。正确方向是抽出统一的角色表现接口，让不同模型有不同实现。

### 2.4 比赛流程太简单

当前 `RaceManager` 只有：

- `READY`
- `COUNTDOWN`
- `RACING`
- `FINISHED`

后续需要表达更多阶段：

- 准备/加载。
- 站上跳台。
- 倒计时。
- 入水/起跳。
- 正式比赛。
- 触壁完赛。
- 名次计算。
- 结果展示。
- 领奖台。
- 重开/返回。

如果不拆，后续这些流程会散落在 `GameManager`、`Swimmer` 和 UI 里。

## 3. 重构目标

1. 保持当前可玩流程稳定。
2. 将比赛模拟和画面表现分离。
3. 泳池、人物、摄像机、UI 尽量可配置、可替换。
4. Cocos `Component` 尽量只做节点绑定和生命周期入口。
5. 用多个小的控制器替代一个巨大的 `GameManager`。
6. 后续功能能自然落到对应模块里。
7. 不过度抽象，先用简单 TypeScript 类和 Cocos 组件解决问题。

## 4. 推荐整体结构

```text
GameBootstrap
  -> GameFlowController
      -> RaceFlowController
      -> VenueManager
      -> CompetitorManager
      -> CameraDirector
      -> UIFlowController
      -> InputRouter

Race domain
  -> RaceStateMachine
  -> RaceSession
  -> RaceRules
  -> RaceResultService
  -> RaceParticipant

Swimmer domain
  -> SwimmerEntity
  -> SwimmerMotor
  -> StrokeMetrics
  -> SwimPhysicsModel
  -> SwimmerPresentation

Character presentation
  -> CharacterRig
  -> CharacterModelLoader
  -> CharacterSkinApplier
  -> FreestylePoseController
  -> SplashEmitter
  -> CharacterDebugController

Venue
  -> PoolSceneLoader
  -> PoolDefinition
  -> LaneLayout
  -> AudienceSpawner
  -> VenueLightingController
  -> WaterSurfaceBinder

Camera
  -> RaceCameraDirector
  -> CameraRig
  -> CameraShot
  -> BroadcastShotSequencer
  -> FovController

UI
  -> ScreenRouter
  -> StartScreenView
  -> RaceHudView
  -> CountdownView
  -> ResultsView
  -> PodiumView
```

核心思路：

- `app` 层只负责启动和总流程调度。
- `race` 层只负责比赛状态、时间、名次、规则。
- `swimmer` 层只负责泳手模拟数据和输入驱动。
- `character` 层负责模型、骨骼、动画、水花、材质。
- `venue` 层负责泳池、场馆、观众、水面。
- `camera` 层负责所有机位和镜头策略。
- `ui` 层负责页面显示和 UI 状态。

## 5. 建议目录结构

```text
assets/scripts/
  app/
    GameBootstrap.ts
    GameContext.ts
    GameFlowController.ts

  config/
    RaceConfig.ts
    VenueConfig.ts
    CompetitorConfig.ts
    CameraConfig.ts

  race/
    RaceFlowController.ts
    RaceStateMachine.ts
    RaceSession.ts
    RaceRules.ts
    RaceResultService.ts
    RaceTypes.ts

  swimmer/
    SwimmerEntity.ts
    SwimmerMotor.ts
    StrokeMetrics.ts
    SwimPhysicsModel.ts
    SwimmerPresentation.ts
    SwimmerTypes.ts

  ai/
    AISwimmerController.ts
    AIStrokeStrategy.ts
    AIProfile.ts

  character/
    CharacterRig.ts
    CartoonCharacterRig.ts
    CharacterModelLoader.ts
    CharacterSkinApplier.ts
    FreestylePoseController.ts
    SplashEmitter.ts
    CharacterDebugController.ts

  venue/
    VenueManager.ts
    PoolSceneLoader.ts
    PoolFallbackBuilder.ts
    LaneLayout.ts
    AudienceSpawner.ts
    VenueLightingController.ts
    WaterSurfaceBinder.ts

  camera/
    RaceCameraDirector.ts
    CameraRig.ts
    CameraShot.ts
    BroadcastShotSequencer.ts
    FovController.ts

  input/
    InputRouter.ts
    StrokeInputSource.ts

  ui/
    UIFlowController.ts
    ScreenRouter.ts
    RaceHudView.ts
    StartScreenView.ts
    CountdownView.ts
    ResultsView.ts
    PodiumView.ts

  shared/
    MathUtils.ts
    NodeUtils.ts
    EventBus.ts
```

依赖方向建议保持：

```text
app -> race / venue / swimmer / camera / ui / input
race -> swimmer 类型，不直接碰 Cocos 节点
swimmer -> character 接口，不关心具体模型实现
character -> Cocos 模型、骨骼、材质、动画
venue -> Cocos 场景、prefab、水面、观众
camera -> Cocos Camera 和镜头策略
ui -> Cocos UI 节点
```

## 6. 模块设计说明

### 6.1 App 层

`GameBootstrap`

- 替代大部分 `GameManager.onLoad`。
- 查找或创建根节点。
- 创建 `GameContext`。
- 初始化各个 manager。
- 启动初始流程。

`GameContext`

- 保存运行时共享引用：
  - `worldRoot`
  - `canvasRoot`
  - `cameraNode`
  - `raceSession`
  - `competitors`
  - 配置对象

`GameFlowController`

- 只做高层流程调度。
- 不直接搭 mesh、不算物理、不摆骨骼、不画 UI。
- 处理开始、重开、进入/退出模型 debug 等流程。

### 6.2 Race 层

建议把比赛阶段改成：

```ts
export enum RacePhase {
    Boot = 'boot',
    Ready = 'ready',
    Intro = 'intro',
    Countdown = 'countdown',
    Dive = 'dive',
    Racing = 'racing',
    Finish = 'finish',
    Results = 'results',
    Podium = 'podium',
}
```

`RaceFlowController`

- 管理倒计时。
- 后续管理入水/起跳阶段。
- 只在起跳阶段结束后进入正式比赛。
- 发出比赛阶段变化事件。

`RaceSession`

- 保存比赛计时、参赛者、当前阶段、完赛记录。
- 不直接操作 Cocos 节点。

`RaceResultService`

- 负责计算 2 人或 8 人比赛名次。
- 后续可扩展犯规、DNF、分段成绩、回放数据。

### 6.3 Swimmer 层

`SwimmerEntity`

- 挂在泳手根节点上的 Cocos 组件。
- 作为门面类，保留对外 API。
- 内部组合：
  - `SwimmerMotor`
  - `StrokeMetrics`
  - `SwimmerPresentation`

建议保留 API：

- `prepareForRace(startPose)`
- `startRace()`
- `stopRace()`
- `applyStroke(type, rhythmResult)`
- `reset()`
- `currentSpeed`
- `distance`
- `isRacing`

`StrokeMetrics`

- 从当前 `Swimmer` 抽出输入频率统计。
- 负责手/腿输入窗口、努力度、同步度。
- 不依赖 Cocos。

`SwimPhysicsModel`

- 从当前 `updateSpeedPhysics` 抽出。
- 输入当前速度、距离、疲劳、努力度、同步度、AI 参数、节奏 bonus。
- 输出下一帧速度和疲劳。
- 以后调速度曲线不用碰动画代码。

`SwimmerMotor`

- 持有速度、距离、疲劳、动作相位。
- 调用 `StrokeMetrics` 和 `SwimPhysicsModel`。
- 通过很薄的一层 adapter 移动节点。

`SwimmerPresentation`

- 把模拟数据转成表现数据：
  - 手部 cycle
  - 腿部 cycle
  - 身体 phase
  - 速度比例
  - 划水 impulse
  - 比赛阶段

这样后续替换模型时，不需要理解内部物理细节。

### 6.4 Character 层

定义统一接口：

```ts
export interface CharacterRig {
    load(options: CharacterLoadOptions): void;
    setRacePhase(phase: RacePhase): void;
    setSwimmingActive(active: boolean): void;
    applyFreestylePose(pose: SwimPoseFrame): void;
    triggerStroke(type: StrokeType, quality: StrokeQuality): void;
    triggerSplash(scale: number): void;
    resetPose(): void;
}
```

当前 `CartoonSwimmerRig` 可以先作为外层组件保留，但内部逐步拆成：

- `CharacterModelLoader`：加载 prefab、绑定骨骼。
- `CharacterSkinApplier`：材质、贴图、描边。
- `FreestylePoseController`：自由泳姿态、动画速度。
- `SplashEmitter`：水花节点和更新。
- `CharacterDebugController`：模型 debug。

未来换人物模型时，只要实现或适配 `CharacterRig`，`SwimmerEntity` 不需要改。

### 6.5 Venue 层

`VenueManager`

- 负责当前场馆生命周期。
- 加载 `PoolDefinition`。
- 调用泳池加载、水面绑定、灯光、泳道布局、观众生成。

`PoolDefinition`

```ts
export type PoolDefinition = {
    id: string;
    prefabPath?: string;
    laneCount: number;
    laneWidth: number;
    raceDistance: number;
    startX: number;
    finishX: number;
    playerLaneIndex: number;
    waterMaterialPath?: string;
    audienceProfile?: string;
};
```

`PoolSceneLoader`

- 只负责加载不同泳池 prefab。

`PoolFallbackBuilder`

- 放当前代码里的程序化 fallback 泳池。
- 只在 prefab 加载失败或开发模式使用。

`LaneLayout`

- 负责泳道中心点、泳道宽度、选手位置计算。
- 移除 `GameManager` 里的泳道硬编码。

`AudienceSpawner`

- 后续从场馆配置生成观众。
- 不影响比赛模拟。

`WaterSurfaceBinder`

- 查找水面节点。
- 开关旧水面/新水面。
- 应用水面材质。
- 承接当前 `configureLoadedPool` 的职责。

### 6.6 Camera 层

`RaceCameraDirector`

- 管理比赛摄像机模式和自动切镜。
- 输入比赛快照。
- 输出镜头目标：
  - camera position
  - look target
  - fov
  - blend speed

`CameraRig`

- 把 position/lookAt/FOV 应用到 Cocos Camera。
- 处理自由镜头输入。

`CameraShot`

```ts
export type CameraShot = {
    id: string;
    minDuration: number;
    maxDuration?: number;
    getPose(snapshot: RaceCameraSnapshot): CameraPose;
};
```

`BroadcastShotSequencer`

- 管理自动切镜顺序。
- 后续可以根据比赛戏剧性切镜：
  - 距离差很近。
  - 快到终点。
  - 玩家落后。
  - 起跳入水。
  - 完赛庆祝。

`FovController`

- 单独处理动态 FOV 平滑。
- 避免 FOV 逻辑混在每个镜头公式里。

### 6.7 UI 层

`UIFlowController`

- 监听比赛阶段和结果事件。
- 决定显示哪个页面。

`ScreenRouter`

- 管理页面显隐。
- 避免业务逻辑到处直接 `node.active = true/false`。

建议拆出的 View：

- `StartScreenView`
- `RaceHudView`
- `CountdownView`
- `ResultsView`
- `PodiumView`
- `DebugPanelView`
- `ModelDebugHudView`

当前 `UIController` 可以逐步拆。第一步可先把 HUD、倒计时、结果拆出去。

### 6.8 Input 层

`InputRouter`

- 替代跨系统的字符串事件，例如 `node.emit('arm-stroke')`。
- 将键盘、鼠标、触摸转成 typed command：

```ts
export type GameCommand =
    | { type: 'stroke'; stroke: StrokeType }
    | { type: 'primaryAction' }
    | { type: 'toggleDebug' }
    | { type: 'cycleCamera' }
    | { type: 'toggleFreeCamera' };
```

本地 UI 按钮可以继续用 Cocos node event，但系统之间建议使用 typed event 或明确 callback。

## 7. 推荐事件

建议引入一个轻量 typed event bus，或者用显式 callback。不要让跨系统玩法逻辑依赖大量字符串事件。

推荐事件：

- `RacePhaseChanged`
- `CountdownTick`
- `RaceStarted`
- `StrokeSubmitted`
- `StrokeRated`
- `ParticipantProgressChanged`
- `ParticipantFinished`
- `RaceFinished`
- `CameraModeChanged`
- `ScreenRequested`

原则：

- 局部 UI 交互可以用 Cocos node event。
- 跨系统逻辑用 typed event/callback。

## 8. 配置化方向

先用 TypeScript 配置对象，后续如果需要策划编辑，再迁到 JSON asset。

建议配置：

- `RaceConfig`：距离、倒计时、目标 BPM、速度参数。
- `VenueConfig`：泳池 prefab、水面材质、泳道数、观众配置。
- `CompetitorConfig`：名字、泳道、AI 参数、模型/皮肤。
- `CameraConfig`：可用机位、镜头时长、FOV 范围。
- `CharacterConfig`：模型路径、rig 类型、材质配置。

这样可以移除 `GameManager` 中的硬编码，例如泳道数、泳池 prefab path、AI profile、摄像机时长、玩家泳道等。

## 9. 迁移计划

### Phase 1：先拆泳手纯逻辑

目标：降低 `Swimmer.ts` 耦合，不改变画面效果。

任务：

- 新增 `StrokeMetrics`。
- 新增 `SwimPhysicsModel`。
- 新增 `SwimmerMotor`。
- `Swimmer` 保持 Cocos 组件和对外 API，内部委托给新类。
- 保留当前 `startRace`、`stopRace`、`handleStroke`、`reset` 等接口。

收益：

- 速度公式和输入统计可以单独调试。
- 最小风险减少 `Swimmer` 体积。

### Phase 2：拆角色表现层

目标：为人物模型替换做准备。

任务：

- 定义 `CharacterRig` 接口。
- 当前 `CartoonSwimmerRig` 先作为外层组件保留。
- 抽出模型加载、材质、姿态、水花、debug 子模块。

收益：

- 后续新增人物模型时，不需要复制整个 `CartoonSwimmerRig`。

### Phase 3：拆 `GameManager` 场景搭建

目标：让 `GameManager` 只保留启动和流程调度。

任务：

- 新增 `VenueManager`。
- 移动泳池 prefab 加载到 `PoolSceneLoader`。
- 移动 fallback mesh 生成到 `PoolFallbackBuilder`。
- 移动灯光到 `VenueLightingController`。
- 移动泳道计算到 `LaneLayout`。
- 移动泳手创建到 `CompetitorManager` 或 `SwimmerFactory`。
- 移动 UI 创建到 UI 模块。

收益：

- 换泳池、加观众不再碰比赛逻辑。

### Phase 4：引入更完整的比赛阶段

目标：支持入水、完赛、结果、领奖台。

任务：

- 用 `RacePhase` 替代或包一层当前 `GameState`。
- 保留兼容映射，避免一次性改爆 UI。
- 增加阶段 hook：
  - ready
  - countdown
  - dive
  - racing
  - finish
  - results
  - podium

收益：

- 新增入水/领奖台不会污染 `GameManager`。

### Phase 5：拆摄像机导演

目标：隔离复杂机位和动态 FOV。

任务：

- 移动 `RaceCameraMode` 和 camera update 到 `RaceCameraDirector`。
- 移动 position/lookAt/FOV 应用到 `CameraRig`。
- 移动自动切镜序列到 `BroadcastShotSequencer`。
- 每帧摄像机基于 `RaceCameraSnapshot` 更新。

收益：

- 新增镜头只改 camera 模块。
- 比赛逻辑不用关心镜头细节。

### Phase 6：拆 UI 页面

目标：支持更多比赛页面和领奖台页面。

任务：

- 拆出倒计时、HUD、结果、开始、debug 等 view。
- 新增 `ScreenRouter`。
- `UIFlowController` 只响应 typed race events。

收益：

- UI 增长不会继续撑大一个 `UIController`。

## 10. 兼容策略

重构过程中先保持以下 API 不变：

- `Swimmer.startRace()`
- `Swimmer.stopRace()`
- `Swimmer.reset()`
- `Swimmer.handleStroke(type)`
- `Swimmer.currentSpeed`
- `Swimmer.distance`
- `AISwimmerController.startSwimming()`
- `AISwimmerController.stopSwimming()`
- `UIController.updateTimer/updateProgress/updateSpeed/showRating/showCountdown/showResult/resetAll`

这样可以分阶段提交，保证每一步都能运行。

## 11. 风险和规避

### 风险：Cocos 场景引用丢失

规避：

- 第一阶段不要急着重命名已有 `ccclass`。
- 先抽纯 TypeScript 类。
- Cocos 组件改名要单独验证场景绑定。

### 风险：物理公式抽出后行为变化

规避：

- 第一版完全复制公式。
- 可以做固定输入脚本，对比速度和距离曲线。
- 抽完后再调参。

### 风险：角色 rig 拆分太大

规避：

- 保留 `CartoonSwimmerRig` 外壳。
- 每次只抽一个子职责。
- 等接口稳定后再做第二种 rig。

### 风险：抽象太早

规避：

- 只有明确会多实现的地方先做接口：
  - character rig
  - camera shot
  - pool loader/fallback
- 其他地方优先用具体类。

## 12. 建议第一步

最推荐先做这一小步：

1. 新增 `swimmer/StrokeMetrics.ts`。
2. 新增 `swimmer/SwimPhysicsModel.ts`。
3. 新增 `swimmer/SwimmerMotor.ts`。
4. 修改 `Swimmer.ts`，把输入统计和速度计算委托出去。
5. 暂时不动 `GameManager`。

这一步收益明显、风险最低，也最容易验证当前比赛手感是否保持一致。

## 13. 重构完成标准

重构完成后应满足：

- `GameManager` 不再包含泳池搭建、摄像机镜头数学、泳手物理、UI 页面细节。
- `Swimmer` 不再包含原始速度公式、输入窗口统计、骨骼 fallback、水花实现。
- `CartoonSwimmerRig` 被拆分，或至少被 `CharacterRig` 接口包住。
- 比赛阶段可以表达倒计时、入水、比赛、完赛、结果、领奖台。
- 新泳池可以通过配置选择。
- 新人物模型可以通过配置选择。
- 新摄像机镜头可以在 camera 模块中添加。
- 新 UI 页面可以订阅比赛事件，不需要改泳手或摄像机代码。

