# Speed Swimming 3D Roadmap

本文档记录当前项目实现状态、关键技术细节、短中长期路线，以及后续改动时需要守住的性能边界。项目目标是做一个适合微信小游戏的抽象 3D 游泳节奏竞速游戏：资源轻、角色可读、玩法反馈明确、运行稳定。

## 当前定位

`Speed Swimming 3D` 是一个 100 米自由泳节奏竞速原型。玩家通过左右输入交替控制腿打水和手划水，系统根据节奏、交替关系、输入频率和同步度驱动速度。当前核心已经是 3D 比赛场景，包含 8 条泳道、低模泳池、低模带骨骼泳者、AI 对手、动态镜头、HUD、模型调试模式和角色描边。

## 当前实现概览

### 场景与资源

- 主场景是 `assets/scenes/MainGame.scene`。
- 运行时入口仍是 `assets/scripts/core/GameManager.ts`，但它现在主要负责启动、流程协调和事件绑定。
- 运行时装配已经拆成多个模块：
  - `assets/scripts/swimmer`：泳手输入窗口、速度物理和移动状态。
  - `assets/scripts/venue`：泳池配置、泳池 prefab 加载、水面绑定、fallback 泳池和泳道布局。
  - `assets/scripts/camera`：比赛摄像机模式、自动转播镜头、自由镜头和 FOV。
  - `assets/scripts/competitor`：玩家/AI 泳手创建、AI 参数、泳衣泳帽颜色配置。
  - `assets/scripts/ui`：运行时 UI factory、HUD、开始页、模型调试 HUD 和 debug 面板构建。
- 当前保留的运行时资源集中在 `assets/resources`：
  - `models/UserSwimmerLow.glb`：当前低模角色，带骨骼和动画。
  - `pool/LowPolyPool.glb`：低模泳池模型。
  - `pool/PoolScene.prefab`：泳池 prefab 入口。
  - `pool/RagingPoolWater.mtl`：水面材质。
  - `pool/SwimmerSplash.mtl`：划水水花材质。
  - `effects/PlayerOutline.effect`：倒壳描边 effect。
- 当前 `tools` 只保留模型源文件和泳池生成脚本：
  - `tools/UserSwimmerLow.blend`
  - `tools/LowPolyPool.blend`
  - `tools/build-lowpoly-pool.py`

### 比赛流程

- `GameManager` 负责状态入口、运行时装配、事件绑定和高层流程协调。
- `RaceManager` 负责倒计时、开赛、计时、进度和完赛回调。
- `GameManager` 会把 `RaceManager` 的状态和计时回调转发给 UI、摄像机和 AI 控制。
- 状态流：
  - `READY`：开始界面。
  - `COUNTDOWN`：5 秒倒计时。
  - `RACING`：玩家和 AI 开始前进。
  - `FINISHED`：展示结果，支持重新开始。
- 比赛距离固定为 `RACE_DISTANCE = 100`。
- 目标帧率当前在 `GameManager.onLoad()` 中设置为 `game.frameRate = 60`，用于排查和避免低帧率锁定。

### 输入与节奏判定

- `InputManager` 统一处理键盘、鼠标和触摸。
- 默认输入：
  - 鼠标左键 / A / 左半屏：腿打水。
  - 鼠标右键 / D / 右半屏：手划水。
  - Space / Enter：开始或重开。
  - C：切换比赛镜头。
  - V：自由镜头。
  - F3 / 反引号：调试面板。
- 比赛中的左右半屏输入现在由 `ui/RaceHudBuilder.ts` 创建不可见命中区直接处理：
  - 左半屏触发 `StrokeType.LEG`。
  - 右半屏触发 `StrokeType.ARM`。
  - 命中区不绘制透明背景和文字，避免中线阴影或提示文案遮挡画面。
  - `GameManager.handlePadStroke()` 做 45ms 同类型去重，防止部分浏览器同时派发 touch/mouse 导致一次点击触发两次。
- `InputManager.pointerInputEnabled` 当前在比赛 HUD 下设为 `false`，保留键盘输入和后续兜底能力，避免全局指针事件与 UI 命中区重复触发。
- `RhythmEvaluator` 负责节奏判定：
  - 目标节奏由 `TARGET_BPM = 156` 和 `TARGET_INTERVAL = 60 / TARGET_BPM` 决定。
  - `PERFECT_WINDOW = 0.08`。
  - `GOOD_WINDOW = 0.18`。
  - 连续同类型输入会判为 `MISS`，鼓励手腿交替。
  - `PERFECT` 会累计 combo，combo 转化为速度倍率。

### 游泳速度模型

- `Swimmer` 现在是 Cocos 组件门面，主要负责节点位置、表现触发和对外 API。
- 速度和输入逻辑拆到 `assets/scripts/swimmer`：
  - `StrokeMetrics`：记录手/腿输入窗口，计算输入频率、effort score 和 sync score。
  - `SwimPhysicsModel`：计算速度、阻力、疲劳、AI 加成和 combo 影响。
  - `SwimmerMotor`：管理速度、距离、动作 cycle、比赛状态推进。
- 当前速度不是简单点一次加一次，而是综合几个因素：
  - 输入频率：最近 `1.2s` 的手/腿输入次数。
  - 同步度：手和腿输入频率越接近越好。
  - 起步阶段：前 15 到 18 米给腿部启动辅助。
  - 高速阻力：速度越接近最大速度，阻力越强。
  - 疲劳：比赛中缓慢累积，当前上限 `0.22`。
  - combo：玩家节奏奖励会提高最大速度和加速度。
- 当前关键常量：
  - `BASE_SPEED = 0.8`
  - `MAX_SPEED = 3.2`
  - `MAX_SWIM_ACCEL = 1.85`
  - `KICK_START_ACCEL = 2.45`
  - `BASE_DRAG = 0.34`
  - `HIGH_SPEED_DRAG = 0.46`

### AI 选手

- `competitor/CompetitorManager.ts` 创建 8 条泳道中的 1 名玩家和 7 名 AI。
- `competitor/SwimmerFactory.ts` 创建单个泳手节点、绑定 `CartoonSwimmerRig`、`RhythmEvaluator` 和 `Swimmer`。
- `competitor/CompetitorConfig.ts` 保存默认 AI profile 和泳衣/泳帽颜色。
- `AISwimmerController` 按目标 BPM 自动交替触发手/腿动作。
- 每条 AI 泳道配置了不同参数：
  - `difficulty`
  - `bpmOffset`
  - `aiPower`
  - `aiMaxSpeedScale`
- 当前 AI 与玩家使用相同肤色，不同泳衣和泳帽颜色；主角通过描边和泳道视觉识别。

### 角色模型与蒙皮

- 当前角色加载路径只保留低模：
  - `models/UserSwimmerLow`
  - `models/UserSwimmerLow/UserSwimmerLow`
- `CartoonSwimmerRig` 实例化 prefab 后会：
  - 查找 `Armature` 作为骨骼根。
  - 绑定关键骨骼：躯干、头、肩、上臂、前臂、手、腿、脚、脚趾。
  - 收集 `SkinnedMeshRenderer`。
  - 强制 `skinningRoot = this._model`。
  - 关闭 baked animation 上传，保持实时骨骼可控。
  - 捕获初始骨骼姿态，后续用相对旋转驱动动作。
- 如果模型自带 `FreestyleFull` 动画，运行时优先播放动画并按速度调节 animation state speed。
- 如果没有合适动画，代码可以退回到手动骨骼驱动：
  - `FREESTYLE_ARM_POSES` 采样手臂关键姿势。
  - `applyLeg` 模拟自由泳打水。
  - `applyUpperBodyRoll` 模拟身体滚转。

### 角色外观

- 低模角色目前走运行时贴图方案，不额外增加衣服网格。
- `makeSwimmerClothesTexture()` 生成 `128x128` RGBA 贴图：
  - 肤色来自 `skinColor`。
  - 连体泳衣来自 `suitColor`。
  - 泳帽来自 `capColor`。
  - 泳帽只覆盖头顶上方区域。
  - 泳衣覆盖躯干、手臂和短裤区域，但手掌保持肤色。
- 这个方案适合微信小游戏：
  - 不增加模型面数。
  - 不增加额外 skinned mesh。
  - 换色成本低。
  - 后续可扩展为队伍色、玩家自定义色或皮肤系统。

### 描边实现

- 当前描边采用倒壳方案，不是屏幕空间后处理。
- `CartoonSwimmerRig.configureOutlineShells()` 为每个 `SkinnedMeshRenderer` 复制一个描边 shell。
- shell 复用原 mesh、skeleton、skinningRoot，只替换为 `PlayerOutline.effect`。
- `PlayerOutline.effect` 关键点：
  - front-face culling。
  - depth test 开启。
  - depth write 关闭。
  - 顶点沿法线外扩：`lineWidth * 0.001`。
  - 颜色为接近黑色。
- 当前代价：
  - 描边会让角色渲染的 skinned mesh draw call 和顶点处理近似翻倍。
  - 对低模角色可接受，但后续大量角色或高模角色不适合继续用此方案。

### 水面与水花

- `venue/VenueManager.ts` 负责构建泳池入口。
- `venue/PoolSceneLoader.ts` 负责加载 `pool/PoolScene`。
- `venue/WaterSurfaceBinder.ts` 负责隐藏旧水面节点、启用透明水面节点并绑定 `pool/RagingPoolWater`。
- `venue/PoolFallbackBuilder.ts` 在泳池 prefab 加载失败时生成基础泳池面、起点线和终点线。
- `WaterSurface` 会收集指定名称的水面节点和波纹节点，给局部水纹做轻微 transform 动画。
- `CartoonSwimmerRig` 自带 `splashNode`，并根据手入水、脚打水和速度更新水花强度。
- 水花材质来自 `pool/SwimmerSplash`，水面材质来自 `pool/RagingPoolWater`。

### 镜头与调试

- 比赛摄像机逻辑已经拆到 `camera/RaceCameraDirector.ts`。
- 比赛镜头支持：
  - 自动转播镜头。
  - 侧面镜头。
  - 追随镜头。
  - 顶视镜头。
  - 第一人称镜头。
  - 自由镜头。
- 自动转播镜头会在倒计时和比赛中切换机位，并在玩家和 AI 接近时进入对抗镜头。
- `GameManager` 每帧只向 `RaceCameraDirector` 提供比赛快照：
  - 玩家 x 坐标。
  - 玩家距离。
  - 最近 AI 距离差。
  - 是否倒计时。
  - 是否比赛中。
- 模型调试模式可用于只看主角动作：
  - A/D 触发腿/手动作。
  - Q/E 调慢或调快动作速度。
  - 鼠标拖拽环绕，滚轮缩放。

### 当前工程结构

当前结构已经从单个 `GameManager` 集中实现，拆成以下主要模块：

```text
assets/scripts/
  core/
    GameManager.ts        # 启动、流程协调、事件绑定、模型 debug 入口
    RaceManager.ts        # 倒计时、比赛计时、进度、完赛回调
    InputManager.ts       # 键盘/鼠标/触摸输入入口
    RhythmEvaluator.ts    # 节奏判定
    WaterSurface.ts       # 水面节点轻动画

  swimmer/
    StrokeMetrics.ts      # 手/腿输入频率、effort、sync
    SwimPhysicsModel.ts   # 速度、阻力、疲劳、AI/节奏加成
    SwimmerMotor.ts       # 距离、速度、动作 cycle、比赛状态

  competitor/
    CompetitorConfig.ts   # AI profile 和选手视觉配置
    SwimmerFactory.ts     # 创建单个泳手和 rig
    CompetitorManager.ts  # 创建玩家、AI 列表和主 AI

  venue/
    VenueConfig.ts        # 泳池默认配置
    LaneLayout.ts         # 泳道中心点和泳池宽度计算
    PoolSceneLoader.ts    # 泳池 prefab 加载
    WaterSurfaceBinder.ts # 水面节点和材质绑定
    PoolFallbackBuilder.ts# fallback 泳池
    VenueManager.ts       # 场馆构建入口

  camera/
    RaceCameraDirector.ts # 比赛镜头、自动转播、自由镜头、FOV

  ui/
    RuntimeUiFactory.ts   # 运行时 UI 基础节点工厂
    RaceHudBuilder.ts     # 比赛 HUD 和结果面板
    StartScreenBuilder.ts # 开始页
    ModelDebugHudBuilder.ts
    DebugPanelBuilder.ts
    UIController.ts       # UI 数据刷新和动画反馈

  entity/
    Swimmer.ts            # Cocos 门面组件，连接 motor 和表现
    AISwimmerController.ts
    CartoonSwimmerRig.ts  # 当前仍偏大的角色表现/模型/水花实现
```

后续继续重构时应保持依赖方向：

```text
GameManager -> race / competitor / venue / camera / ui
Swimmer -> swimmer motor / rhythm / character rig
competitor -> entity / ai / config
venue -> Cocos prefab/material/water details
camera -> Cocos Camera details
ui -> Cocos UI details
```

## 近期 Roadmap

### 1. 稳定帧率与性能基线

目标：确认浏览器、Cocos Preview、微信小游戏中的帧率差异来源，建立可重复的性能检查方式。

实现细节：

- 在调试面板增加实时 FPS、draw call、选手数量、描边开关状态。
- 增加一个轻量 PerformanceMode 配置：
  - `outlineEnabled`
  - `waterMotionEnabled`
  - `splashEnabled`
  - `aiCount`
  - `cameraMode`
- 在微信小游戏构建前默认使用性能模式：
  - 保留主角描边。
  - AI 描边按实际机型决定是否打开。
  - 水花降低更新频率。
  - 调试日志默认关闭。
- 检查 `game.frameRate = 60` 在微信小游戏环境是否被平台接管，如果被接管，保留日志但不依赖它作为唯一控制手段。

验收标准：

- 浏览器运行稳定接近 60 FPS。
- 中低端设备可通过配置降低效果保持 30 FPS 以上。
- Debug 信息能解释“为什么现在是 30/60/其他帧率”。

### 2. 角色渲染与描边优化

目标：保留角色辨识度，同时降低描边带来的额外顶点和 draw call。

实现细节：

- 给 `CartoonSwimmerRig.build()` 增加更明确的参数对象，替代当前多个布尔参数：
  - `skinColor`
  - `suitColor`
  - `capColor`
  - `robotStyle`
  - `outlineMode`
  - `outlineWidth`
- 支持描边分级：
  - `none`：不描边。
  - `playerOnly`：只给主角。
  - `allThin`：所有角色细描边。
  - `all`：所有角色当前粗描边。
- 描边 shell 节点复用材质实例或共享 effect，避免每个角色重复创建过多材质状态。
- 给 `PlayerOutline.effect` 的 `lineWidth` 做设备相关配置，防止不同运行环境粗细不一致。

验收标准：

- 主角在所有镜头都可读。
- 浏览器和编辑器描边粗细差异可控。
- 8 名角色同时显示时没有明显卡顿。

### 3. 游戏手感调参

目标：让输入、节奏和速度反馈更符合玩家直觉。

实现细节：

- 把 `swimmer/SwimPhysicsModel.ts` 和 `swimmer/StrokeMetrics.ts` 中的速度参数整理为一个配置对象，便于调参：
  - `inputWindow`
  - `targetLimbRate`
  - `maxAccel`
  - `kickStartAccel`
  - `baseDrag`
  - `highSpeedDrag`
  - `desyncPenalty`
  - `fatigueRate`
- 在 debug panel 展示：
  - 当前手频率。
  - 当前腿频率。
  - effort score。
  - sync score。
  - combo bonus。
  - drag 和 accel。
- 调整起步阶段逻辑，确保“只狂点腿”可以起步，但想冲高速必须手腿同步。

验收标准：

- 新玩家能在 2 到 3 局内理解交替输入。
- 高手能通过稳定节奏明显领先 AI。
- 速度曲线不会突然爆炸或无故掉速。

### 4. UI 与比赛反馈

目标：让玩家知道自己为什么快、为什么慢、什么时候赢。

实现细节：

- 增加进度条或泳道小地图，显示玩家和主要 AI 的相对位置。
- rating 文案保留 `PERFECT / GOOD / MISS`，但增加颜色和动画区分。
- 在比赛结束面板展示：
  - 完赛时间。
  - 最长 combo。
  - 平均速度。
  - Perfect/Good/Miss 次数。
- 移动端触摸区保持左右半屏不可见命中区，不显示 `LEFT / KICK`、`RIGHT / ARM` 等提示文字。

验收标准：

- 玩家不看代码也能理解“交替输入 + 稳定节奏 = 更快”。
- 小屏幕上 HUD 不遮挡角色和泳道。

## 中期 Roadmap

### 5. 低模角色资产管线

目标：建立可重复生成和调整低模角色的资产流程，而不是每次手工猜。

实现细节：

- 保留 `tools/UserSwimmerLow.blend` 作为当前低模源文件。
- 建议重新补一个 `tools/build-user-swimmer-low.py`，但只依赖当前保留的源文件，不再依赖已删除的高模。
- Blender 导出规范：
  - 单个 skinned mesh 优先。
  - 骨骼命名保持当前代码可识别。
  - 三角面数控制在 1000 到 1500 左右。
  - UV 保持 0 到 1，便于运行时程序贴图。
  - 导出前确认 `FreestyleFull` 动画是否需要保留。
- 在 Cocos 导入后确认 prefab 路径仍为 `models/UserSwimmerLow`。

验收标准：

- 替换模型后 `CartoonSwimmerRig` 不需要改代码。
- 手掌、脚掌、脖子、胸口等关键轮廓不破碎。
- 运行时动态换色仍可用。

### 6. 泳衣与皮肤系统

目标：在不增加面数的前提下，支持更多外观变化。

实现细节：

- 继续使用运行时贴图作为主方案。
- 将 `swimmerTextureColor()` 的区域逻辑拆成可配置模板：
  - 连体泳衣。
  - 短裤泳衣。
  - 训练服风格。
  - 队服色块。
- 增加颜色参数：
  - 主色。
  - 边线色。
  - 泳帽色。
  - 肤色。
- 未来如需要更精细的衣服边界，可改为预制 mask texture：
  - 一张低分辨率 mask 控制皮肤/泳衣/泳帽区域。
  - 代码只负责调色，不负责复杂几何判断。

验收标准：

- 不增加 mesh 数量。
- 换色即时生效。
- 玩家和 AI 可以在同一模型上表现出明显区分。

### 7. AI 与难度曲线

目标：比赛既有挑战，又不会让玩家觉得 AI 作弊。

实现细节：

- AI 参数已经从 `GameManager` 提取到 `competitor/CompetitorConfig.ts`，后续继续扩展为难度配置表。
- 增加难度等级：
  - Easy：AI 节奏误差大，最高速度低。
  - Normal：当前参数附近。
  - Hard：AI 接近稳定节奏，但仍有随机失误。
- 主要 AI 与其他 AI 区分：
  - 主要 AI 用于胜负判定和 HUD。
  - 其他 AI 用于营造比赛氛围。
- 增加轻微“比赛导演”逻辑：
  - 如果玩家落后太多，AI 稍微降一点节奏稳定性。
  - 如果玩家领先太多，主要 AI 稍微提高追赶动力。
  - 调整幅度必须很小，避免作弊感。

验收标准：

- Normal 难度下玩家练习后能稳定获胜。
- Hard 难度需要更好的节奏。
- AI 行为看起来像运动员，而不是匀速滑行。

### 8. 微信小游戏适配

目标：保证在微信小游戏环境内资源、性能和交互都可控。

实现细节：

- 控制包体：
  - 当前大资源已清理，继续避免把原始高模、预览图、备份文件放入 `assets`。
  - Blender 源文件在 `tools` 中，后续可考虑不进入发布分支。
- 触摸输入：
  - 左右半屏点击继续作为主输入，触摸区必须保持不可见，不绘制半透明背景，避免屏幕中央出现拼接阴影。
  - 需要明确处理多点触控，避免左右同时点时被吞。
- 渲染：
  - 默认低模、低分辨率运行时贴图。
  - 描边和水花提供开关。
  - 避免屏幕空间后处理作为主路径。
- 日志：
  - 发布版本关闭高频 `console.log`。

验收标准：

- 微信开发者工具能正常加载资源。
- 真机不出现资源路径缺失。
- 中低端设备可进入比赛并完成一局。

## 长期 Roadmap

### 9. 比赛内容扩展

- 增加 50m、100m、200m 不同距离。
- 增加练习模式，只显示节奏和速度曲线。
- 增加生涯或关卡：
  - 初级泳池。
  - 校队比赛。
  - 城市赛。
  - 决赛。
- 增加简单排行榜：
  - 本地最佳时间。
  - 微信好友榜后续再接。

### 10. 动作表现升级

- 保留当前低模骨骼结构。
- 优先优化动作曲线，而不是增加面数。
- 将自由泳动作拆为：
  - 手入水。
  - 抱水。
  - 推水。
  - 出水。
  - 空中移臂。
  - 打水上摆/下压。
- 用更少的关键帧提高动作可信度。
- 后续可增加入水泡沫和拖尾，但要绑定性能开关。

### 11. 工程结构整理

- 已完成第一轮拆分：
  - `swimmer/*`
  - `venue/*`
  - `camera/RaceCameraDirector`
  - `competitor/*`
  - `ui/*Builder`
- 后续继续拆分：
  - `GameFlowController`：开始、重开、返回开始页、比赛状态协调。
  - `ModelDebugFlowController`：模型 debug 进入/退出、debug 摄像机、动作速度控制。
  - `SceneBootstrap` 或 `RuntimeSceneBuilder`：Canvas、世界根节点、摄像机、灯光、清理旧节点。
- 将游戏参数集中到配置文件或 `GameBalance.ts`。
- 将资源路径集中到 `ResourcePaths.ts`。
- 为核心逻辑补充单元测试或轻量脚本测试：
  - `RhythmEvaluator`
  - `Swimmer` 速度公式
  - AI 输入节奏

## 技术债与注意事项

- `GameManager.ts` 已完成第一轮瘦身，但仍承担高层流程、事件绑定、模型 debug 和基础场景 setup，后续功能继续增加前应继续拆分。
- `CartoonSwimmerRig.ts` 仍是当前最大技术债，混合了模型加载、骨骼绑定、材质贴图、水花、动作和 debug。后续应按 TDB 拆出角色表现接口和子模块。
- 当前 `RhythmEvaluator` 用 `Date.now()` 计算输入间隔，这在暂停、低帧率或测试中不够理想。更稳的方案是由游戏时钟传入时间。
- 描边 shell 会增加渲染成本；角色数量或模型复杂度增加时，需要默认关闭 AI 描边或改为更便宜的识别方式。
- 运行时程序贴图目前是基于 UV 位置的区域判断，模型 UV 一旦变化，衣服区域可能错位。后续资产管线要固定 UV 规范，或改为 mask texture。
- 调试日志目前较多，发布前应加全局 debug 开关。
- `tools` 目录仍包含 `.blend` 源文件，适合开发协作，但发布包不应包含这些源文件。

## 建议优先级

1. 建立性能面板和性能模式。
2. 把描边改成可配置分级，默认主角优先。
3. 调整速度手感和节奏反馈。
4. 增加比赛结果统计和进度可视化。
5. 固化低模角色资产管线。
6. 做微信小游戏真机适配和发布前资源检查。

## 当前验收基线

- 项目能在 Cocos Creator 3.8.8 中打开。
- 主比赛场景可通过运行时模块生成 UI、泳池、角色、AI 和比赛镜头。
- 当前运行资源均在 `assets/resources` 下有明确引用。
- 低模角色使用动态贴图换色，不依赖额外衣服 mesh。
- 描边资源路径为 `resources/effects/PlayerOutline`。
- TypeScript 检查使用以下命令：

```bash
npx --yes --package typescript tsc --noEmit --ignoreDeprecations 6.0 --skipLibCheck
```

说明：

- `--ignoreDeprecations 6.0`：绕过新版 TypeScript 对 Cocos 临时 tsconfig 中 `moduleResolution=node10` 的弃用报错。
- `--skipLibCheck`：跳过 Cocos Creator 3.8.8 自带 `.d.ts` 与新版 TypeScript 的兼容报错，只检查项目代码。
- 该命令是当前重构阶段的编译级验证基线。
