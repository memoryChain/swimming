# Speed Swimming 3D Roadmap

## 2026-06-06 输入、动作、稳定性与速度模型重设计

这一版把游泳主规则收敛为一条更简单的运行路径：输入只负责触发动作，动作队列只保留“当前动作 + 一个缓存动作”，速度由“动作加速度 - 泳池/水阻减速度”推进，评分只看长按稳定性。

### 基础输入语义

- `A`：左手划一圈水，同时右脚打一次水。
- `D`：右手划一圈水，同时左脚打一次水。
- `A` 和 `D` 不再做同时输入合并判断。即使两个键几乎同时按下，也会作为一次 `A` 和一次 `D` 分别进入各自动作队列。
- 每个肢体的动作队列最多保留两轮弧度量，也就是当前正在播放的一轮加上下一轮缓存输入。队列满时，新的输入不会继续堆积，也不会继续提供加速度。

### 动作播放

- 按住按键时，对应侧动作按 `MOTION_TUNING.heldMotionSpeedScale` 播放。
- 松开按键后，对应侧剩余动作按 `MOTION_TUNING.releasedMotionSpeedScale` 追完。
- 某轮动作一旦检测到松开，该轮动作在播放结束前会锁定为松开后的追完逻辑；同一按键再次按下不会重新影响这一轮动作，只会尝试进入下一轮缓存。
- 如果松开后、当前轮结束前再次按住同一按键并成功进入缓存，缓存动作会在当前轮结束后立即开始。此时长按计时从缓存动作真正开始播放的时间点算起，而不是从提前按下的时间点算起。
- `MOTION_TUNING.animationSpeedScale` 是比赛和 debug model 共用的整体动画倍率。
- 动作一轮基础时间由当前速度决定：当前速度 / `SWIMMER_BALANCE.maxSpeed` 得到速度比例，再从 `armMinCyclesPerSecond` / `kickMinCyclesPerSecond` 插值到 `maxCyclesPerSecond`。速度越高，一轮动作时间越短。
- 当前默认 `maxCyclesPerSecond = 2.8`，避免高速后动作一轮被压得过短；如果按最高速 `4.0m/s` 估算，最高速时一轮动作约 `0.36s`。

### 稳定性评分

- 稳定性优先在松开按键时做预测结算，这样评分和加速度反馈会跟随玩家的松手节奏立即出现。如果某轮动作一直按到播放完成都没有松开，则在动作完成时用实际时长结算。
- 每轮动作先计算本轮比例：`r_i = holdSeconds_i / actionSeconds_i`。其中 `holdSeconds_i` 是本轮动作时间窗口内按键处于按住状态的重叠时间，`actionSeconds_i` 是本轮动作从开始到完成的总时间；松开时使用“当前已播放时间 + 按释放速度追完剩余进度的预计时间”作为预测 `actionSeconds_i`。
- 本轮按住时间还必须达到 `STABILITY_TUNING.minHoldSeconds`。低于这个绝对时长时，本轮稳定性直接为 0，即使按住比例和最近波动看起来很平稳，也不算有效稳定节奏。
- 每轮动作只结算一次。已经在松开时预测结算过的动作，播放完成时不会再次评分或重复给稳定性加速度。
- 最近比例窗口为 `W = {r_{n-k+1}, ..., r_n}`，`k = STABILITY_TUNING.sampleWindowSize`，默认使用最近 5 轮，不足 5 轮时使用已有样本。
- 窗口均值：`mu = average(W)`；窗口标准差：`sigma = sqrt(average((r_i - mu)^2))`。`sigma` 越小，说明最近几轮按住比例越平缓，稳定性越高。
- 波动评分用 `perfectStdDev` 到 `badStdDev` 做平滑衰减：`consistency = 1 - smoothstep(clamp((sigma - perfectStdDev) / (badStdDev - perfectStdDev)))`。
- 为避免一直极短按或一直几乎全程按住也拿满奖励，会再计算有效比例权重：平均比例 `mu` 低于 `minUsefulRatio` 或高于 `maxUsefulRatio` 时逐步压低奖励，过渡宽度由 `usefulRatioEdgeWindow` 控制。
- 输入新鲜度用于避免无脑快速 AD 把缓存队列长期塞满后仍拿满奖励：
  - 动作入队时记录 `queuedAt`，真正开始播放时记录 `startedAt`。
  - 提前量：`leadSeconds = max(0, startedAt - queuedAt)`。
  - 提前比例：`leadRatio = leadSeconds / actionSeconds`。
  - `leadRatio <= inputFreshnessGraceRatio` 时，新鲜度为 1，正常提前一点缓存不受影响。
  - 超过宽容后，新鲜度按 `inputFreshnessPenaltyRatio` 平滑衰减到 `inputFreshnessMinScale`。
- 最终稳定性：`stability = consistency * usefulRatioWeight(mu) * inputFreshness`，范围固定在 `[0, 1]`。稳定性越高，额外加速度越高。
- 稳定性只奖励加速度，不再直接提高最高速度倍率。

### 速度推进

- 每轮动作开始播放时开启基础动作加速度：`SWIMMER_BALANCE.strokeBaseAccel`。如果输入只是进入缓存队列，要等缓存动作真正开始播放时才给这段基础加速度；基础动作加速度也会乘以输入新鲜度，所以过早缓存不能靠队列拿满基础收益。
- 松开按键预测结算，或未松开时动作完成结算后，会用 `SWIMMER_BALANCE.strokeStabilityAccel * stability` 叠加额外加速度。
- 推进收益会额外乘以“交替质量”，避免只按 `A` 或只按 `D` 获得和左右轮换一样的收益。
- 交替质量使用最近 `SWIMMER_BALANCE.alternationWindowSize` 轮动作计算：`balance = 1 - abs(leftCount - rightCount) / count`。最近动作越接近左右均衡，`balance` 越接近 1；只按单侧时 `balance` 接近 0。
- 基础动作加速度倍率：`alternationBaseMinScale + (1 - alternationBaseMinScale) * balance`。默认只按单侧仍保留 25% 基础动作加速。
- 稳定加速度倍率：`alternationStabilityMinScale + (1 - alternationStabilityMinScale) * balance`。默认只按单侧只保留 10% 稳定加速。
- 加速度持续时间为当前动作一轮时间乘 `SWIMMER_BALANCE.strokeAccelDurationRatio`。
- `PERFECT` 会累计稳定性 combo；当 combo 达到 `SWIMMER_BALANCE.perfectComboBoostInterval` 的整数倍时，会触发一次里程碑奖励，把当前速度直接增加 `perfectComboSpeedBonus`。
- 这个里程碑奖励允许速度短暂超过 `SWIMMER_BALANCE.maxSpeed`，但最多只超出 `perfectComboMaxOvercap`；超速上限会按 `perfectComboOvercapDecay` 回落，实际速度还会继续受水阻和泳池减速影响。
- `SwimPhysicsModel` 每帧用动作加速度减去三类减速：`SWIMMER_BALANCE.poolDeceleration`、`baseDrag * currentSpeed`、`highSpeedDrag * speedRatio * currentSpeed`。
- `poolDeceleration` 是泳池/场景固定减速度，后续不同泳池可以用它做场景手感差异。

### Debug Model 调参

- Debug model 左侧面板现在只展示当前规则实际读取的参数组：`输入`、`跳水`、`速度`、`稳定性`、`动作`。输入组只保留触摸去重，不再暴露双键合并参数。
- 每个参数都有中文名称、中文说明、步进、范围和单位。
- 顶部会显示当前稳定性评分和模拟速度，便于直接对照比赛内 HUD。
- 比赛 HUD 和 debug model HUD 都实时显示 `STB`、`ACC`、`SPD`：
  - `STB` 是最近一次松开预测结算或动作完成实际结算得到的稳定性百分比。
  - `ACC` 是当前帧净加速度，已经扣掉泳池减速和水阻。
  - `SPD` 是当前速度，单位为 `m/s`。
- Debug model 的速度行额外显示 `FRS`，表示最近一次结算的输入新鲜度。快速 AD 把动作提前塞进缓存时，`FRS` 应该明显下降。
- `重置` 会恢复本次运行加载时的代码默认值；当前代码默认值已经同步为最近一次满意的 `tuning.json` 数值，后续调参会以这套手感为基准。
- 调参配置现在优先保存到项目资源：`assets/resources/config/tuning.json`，运行时启动会先读取这份配置。
- 保存文件版本为 `3`，`values` 使用稳定英文 id 作为 key，例如 `speed.strokeBaseAccel`，方便手动修改和长期维护。

本文档记录当前项目实现状态、关键技术细节、短中长期路线，以及后续改动时需要守住的性能边界。项目目标是做一个适合微信小游戏的抽象 3D 游泳节奏竞速游戏：资源轻、角色可读、玩法反馈明确、运行稳定。

## 当前定位

`Speed Swimming 3D` 是一个 100 米自由泳节奏竞速原型。玩家通过左右输入交替控制对角肢体：A/左侧驱动左手和右脚，D/右侧驱动右手和左脚；系统根据节奏、交替关系、输入频率和同步度驱动速度。当前核心已经是 3D 比赛场景，包含 8 条泳道、低模泳池、低模带骨骼泳者、AI 对手、动态镜头、HUD、模型调试模式和角色描边。

### 2026-06-06 输入、动作与稳定性规则

当前输入手感已从“节奏窗口 + combo 速度倍率”调整为“动作队列 + 长按稳定性 + 单次动作加速度”：

- 基础动作语义不变：
  - `A` 控制左手划一圈水，同时右脚打一次水。
  - `D` 控制右手划一圈水，同时左脚打一次水。
  - 合并窗口内的 `A + D` 仍会触发 `StrokeType.BOTH`，四肢同时动作。
- 动作播放规则：
  - 按住按键时，该侧动作按 `MOTION_TUNING.heldMotionSpeedScale` 缓慢播放。
  - 松开按键后，该侧剩余动作按 `MOTION_TUNING.releasedMotionSpeedScale` 加速追完。
  - 一轮动作松开后会锁定释放速度直到本轮完成；本轮完成前再次按下同一按键，只会缓存下一轮输入，不会把当前轮重新切回按住速度。
  - 缓存输入如果保持按住，下一轮开始时才开始计算本轮长按时间。
  - 每个肢体最多保留“当前动作 + 一个待执行输入”，由 `SwimmerMotor` 用剩余弧度上限控制。
  - 比赛动作一轮时间不再由输入频率直接决定，而是跟当前速度相关：速度越快，`armMinCyclesPerSecond/kickMinCyclesPerSecond` 会向 `maxCyclesPerSecond` 插值，动作一轮时间变短。
- 稳定性规则：
  - 稳定性优先在松开按键时预测计算；如果一轮动作没有松开就播放完成，则在完成时用实际时长计算。
  - 每轮先算本轮比例：`holdSeconds / actionSeconds`。松开时的 `actionSeconds` 使用释放速度预测出来。
  - 每轮还会检查 `holdSeconds >= STABILITY_TUNING.minHoldSeconds`。如果长按时间太短，本轮稳定性直接为 0。
  - 同一轮动作只结算一次，预测结算后完成时不再重复评分。
  - 最近 `STABILITY_TUNING.sampleWindowSize` 轮比例组成滚动窗口，默认最近 5 轮。
  - 用窗口标准差衡量平稳程度：标准差越小，说明最近几轮按住比例越一致，稳定性越高。
  - `perfectStdDev` 到 `badStdDev` 控制波动评分衰减；`minUsefulRatio`、`maxUsefulRatio` 和 `usefulRatioEdgeWindow` 防止极短按或几乎全程按住拿满奖励。
  - 输入新鲜度会惩罚过早进入缓存的动作：`leadRatio = (startedAt - queuedAt) / actionSeconds`，超过 `inputFreshnessGraceRatio` 后按 `inputFreshnessPenaltyRatio` 平滑降到 `inputFreshnessMinScale`。
  - 最终稳定性会乘以输入新鲜度；快速 AD 连打如果长期把缓存塞满，就算按住比例很平稳，也不能一直拿 `PERFECT`。
  - 稳定性只奖励加速度，不再直接提高最高速度倍率。
- 速度规则：
  - 每轮动作开始播放时开启一段基础加速度：`SWIMMER_BALANCE.strokeBaseAccel`；缓存输入不会在按下当帧提前给推进力，过早缓存的基础加速度也会被输入新鲜度压低。
  - 松开预测结算或动作完成实际结算时，根据稳定性附加额外加速度：`SWIMMER_BALANCE.strokeStabilityAccel * stability`。
  - 基础加速和稳定加速都会乘以最近左右动作分布得到的交替质量。只按单侧仍能游动，但收益会被 `alternationBaseMinScale` 和 `alternationStabilityMinScale` 压低；左右轮换越均衡，收益越完整。
  - 加速度持续时间按当前动作一轮时间乘 `SWIMMER_BALANCE.strokeAccelDurationRatio`。
  - `SwimPhysicsModel` 现在使用动作加速度、基础水阻、高速水阻和泳池固定减速度更新速度。
  - 泳池/场景减速度参数是 `SWIMMER_BALANCE.poolDeceleration`，后续不同泳池可以基于它做场景差异。
- 计分反馈：
  - HUD 的 `PERFECT / GOOD / BAD` 现在表示长按稳定性，而不是旧的左右节奏窗口。
  - 比赛结果中的 P/G/B 统计也来自稳定性释放评分。
  - 旧 `RhythmEvaluator` 仍保留在工程里，但当前速度主路径不再依赖它。

## 当前实现概览

### 场景与资源

- 默认入口场景是 `assets/scenes/Login.scene`，只负责展示轻量登录/开始入口并跳转到 `MainGame`。
- 主场景是 `assets/scenes/MainGame.scene`。
- 运行时入口仍是 `assets/scripts/core/GameManager.ts`，但它现在主要负责启动、模块创建和高层流程协调，输入/UI/debug 细节已经继续下沉到专门模块。
- 运行时装配已经拆成多个模块：
  - `assets/scripts/app`：运行时场景基础搭建、模型 debug 流程控制。
  - `assets/scripts/swimmer`：泳手输入窗口、速度物理和移动状态。
  - `assets/scripts/venue`：泳池配置、泳池 prefab 加载、水面绑定、fallback 泳池和泳道布局。
  - `assets/scripts/camera`：比赛摄像机模式、自动转播镜头、自由镜头和 FOV。
  - `assets/scripts/competitor`：玩家/AI 泳手创建、AI 参数、泳衣泳帽颜色配置。
  - `assets/scripts/character`：角色 rig 接口、模型加载工具、皮肤/描边应用、自由泳骨骼姿态、水花 emitter。
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
- `RaceManager` 负责倒计时、玩家跳水、开赛、计时、进度和完赛回调。
- `GameManager` 会把 `RaceManager` 的状态和计时回调转发给 UI、摄像机和 AI 控制。
- 状态流：
  - `READY`：开始界面。
  - `COUNTDOWN`：5 秒倒计时，玩家可按住 `A + D` 提前蓄力。
  - `DIVING`：倒计时结束后的出发阶段，玩家松开 `A/D` 后跳水，AI 会按各自反应时间自动跳水。
  - `GLIDING`：保留的滑行状态；当前默认跳水完成后不再主动进入该状态，避免入水后还要等待才能划水。
  - `RACING`：玩家和 AI 开始前进，普通划水输入立即生效。
  - `FINISHED`：展示结果，支持重新开始。
- 跳水阶段当前由 `GameFlowController` 协调：
  - 玩家蓄力由 `InputManager` 发出 `dive-charge-start` / `dive-release` 事件。
  - 倒计时期间按住 `A + D` 会显示跳水蓄力条。蓄力条在倒计时文字右侧竖向显示，从下到上填充；数值按三角波从 0 涨到 1，再从 1 降回 0，循环往复；松开时使用当前蓄力条值计算跳水力度。
  - 跳水力度由 `DIVE_BALANCE.minPower + charge * (1 - minPower)` 得到，因此蓄力条越接近顶部，起跳距离和入水速度越高。
  - `RaceManager.startFromDive()` 负责玩家跳水完成后直接切入 `RACING`，让入水并启动 `SwimmerMotor` 后立刻可以划水。
  - 所有 AI 由 `GameFlowController.prepareAndScheduleAiDives()` 独立调度，基于 AI profile 中的 `diveReaction`、`divePower` 和少量随机波动计算反应时间与跳水能力。
- 比赛距离固定为 `RACE_DISTANCE = 100`。
- 目标帧率当前在 `GameManager.onLoad()` 中设置为 `game.frameRate = 60`，用于排查和避免低帧率锁定。

### 输入与节奏判定

- `InputManager` 统一处理键盘、鼠标和触摸。
- 默认输入：
  - 倒计时/跳水阶段：同时按住 `A + D` 蓄力，倒计时结束后松开触发跳水。
  - 鼠标左键 / A / 左半屏：左手划一圈水，同时右脚打一次水。
  - 鼠标右键 / D / 右半屏：右手划一圈水，同时左脚打一次水。
  - Space / Enter：开始或重开。
  - C：切换比赛镜头。
  - V：自由镜头。
  - F3 / 反引号：调试面板。
- 比赛中的左右半屏输入现在由 `ui/RaceHudBuilder.ts` 创建不可见命中区直接处理：
  - 左半屏触发 `StrokeType.LEFT`，对应左手 + 右脚。
  - 右半屏触发 `StrokeType.RIGHT`，对应右手 + 左脚。
  - 命中区不绘制透明背景和文字，避免中线阴影或提示文案遮挡画面。
  - `InputRouter.handlePadStroke()` 做 45ms 同类型去重，防止部分浏览器同时派发 touch/mouse 导致一次点击触发两次。
- `InputManager.pointerInputEnabled` 当前在比赛 HUD 下设为 `false`，保留键盘输入和后续兜底能力，避免全局指针事件与 UI 命中区重复触发。
- `InputManager` 现在同时监听 `KEY_DOWN / KEY_UP`，用于判断按键是否处于按住状态：
  - 在跳水阶段，`A + D` 同时按住用于蓄力，松开后触发跳水。
  - 在游泳阶段，按住状态会影响动作播放速度：按住时对应肢体动作以普通速度播放，松开后剩余动作加速补完。
  - 左右按住状态会传给 `InputRouter` / `GameFlowController` / `Swimmer` / `CartoonSwimmerRig`，从而同时影响节奏长按奖励和模型表现。
- `RhythmEvaluator` 负责节奏判定：
  - 目标节奏由 `GameBalance.RHYTHM_BALANCE.targetBpm = 156` 和 `getTargetInterval() = 60 / targetBpm` 决定。
  - Perfect 窗口来自 `InputTuning.INPUT_TUNING.rhythmPerfectWindowSeconds = 0.08`。
  - Good 窗口来自 `InputTuning.INPUT_TUNING.rhythmGoodWindowSeconds = 0.18`。
  - 连续同侧输入会判为 `BAD`，鼓励左右对角肢体交替。
  - `A + D` 在 `InputTuning.INPUT_TUNING.chordMergeWindowMs = 70` 毫秒内几乎同时按下时，会被合并成 `StrokeType.BOTH`：
    - `BOTH` 只记一次输入节奏和一次速度推进，避免同一次双键输入拿到双倍动力。
    - `BOTH` 可以连续按目标节奏重复，从而让同步按 `A + D` 也能游起来。
    - `BOTH` 的 Perfect/Good 节奏窗口使用 `bothRhythmPerfectWindowSeconds` / `bothRhythmGoodWindowSeconds`，比左右交替更窄。
    - `BOTH` 不吃交替输入的“过快宽容”窗口，乱按或狂按会更容易判 `BAD`。
    - `BOTH` 判 `BAD` 时仍播放弱动作反馈，但不会写入推进频率统计，避免靠高频双键刷速度。
  - 当前游泳主路径不再使用这套旧的松键时长评分。旧 `RhythmEvaluator` 仍保留在工程中作为历史/兼容代码，但比赛和 debug model 的稳定性已经改为“松开时预测结算，或未松开时动作完成结算最近 5 轮按住比例标准差”。
  - `PERFECT` 会累计稳定性 combo；combo 不再转化为持续速度倍率，而是在达到固定间隔时触发一次临时超速奖励。

### 游泳速度模型

- `Swimmer` 现在是 Cocos 组件门面，主要负责节点位置、表现触发和对外 API。
- `Swimmer` 管理两套出发坐标：
  - 游泳基准点：水面附近的比赛起点，用于 `SwimmerMotor.distance`。
  - 跳台站位点：通过 `DIVE_PLATFORM_NODE_OFFSET` 从游泳基准点偏移，让运动员在倒计时阶段站到出发台上。
- `Swimmer.prepareDive()` 会将运动员摆到跳台站位并恢复赛前站姿。
- `Swimmer.performDive(power)` 会播放下蹲、起跳、入水 tween，并将跳水距离和入水速度传给 `SwimmerMotor.startRace(initialDistance, initialSpeed)`。
- 速度和输入逻辑拆到 `assets/scripts/swimmer`：
  - `StrokeMetrics`：记录手/腿输入窗口，计算输入频率、effort score 和 sync score。
  - `SwimPhysicsModel`：计算速度、阻力和 AI 加成。
  - `SwimmerMotor`：管理速度、距离、动作 cycle、比赛状态推进。
- 当前速度不是简单点一次加一次，而是综合几个因素：
  - 输入频率：最近 `1.2s` 的手/腿输入次数。
  - 同步度：手和腿输入频率越接近越好。
  - 起步阶段：前 15 到 18 米给腿部启动辅助。
  - 高速阻力：速度越接近最大速度，阻力越强。
  - combo：玩家稳定性 combo 达到里程碑时，会直接奖励一段可超出最高速度的临时速度。
- 当前关键速度参数集中在 `core/GameBalance.ts`：
  - `SWIMMER_BALANCE.baseSpeed = 0.8`
  - `SWIMMER_BALANCE.maxSpeed = 3.2`
  - `SWIMMER_BALANCE.maxSwimAccel = 1.85`
  - `SWIMMER_BALANCE.kickStartAccel = 2.45`
  - `SWIMMER_BALANCE.baseDrag = 0.34`
  - `SWIMMER_BALANCE.highSpeedDrag = 0.46`

### AI 选手

- `competitor/CompetitorManager.ts` 创建 8 条泳道中的 1 名玩家和 7 名 AI。
- 当前比赛对手已恢复：`GameManager` 内 `RACE_OPPONENTS_ENABLED = true`，AI 节点会参与倒计时、跳水、游泳和主 AI 胜负判定。
- `competitor/SwimmerFactory.ts` 创建单个泳手节点、绑定 `CartoonSwimmerRig` 和 `Swimmer`。
- `competitor/CompetitorConfig.ts` 保存默认 AI profile 和泳衣/泳帽颜色。
- `AISwimmerController` 不再模拟玩家输入，不调用 `handleStroke()` / `handleStrokeHeld()`，因此 AI 不再进入玩家的动作队列、长按预测、稳定性评分和 badReason 链路。
- AI 游泳拆成两层：
  - 速度层：`SwimPhysicsModel` 检测 `input.isAI` 后使用 `SWIMMER_BALANCE.aiCruiseAccel` 给 AI 持续推进，并继续受 `aiPower`、`aiMaxSpeedScale`、泳池减速和阻力影响。
  - 表现层：`AISwimmerController` 按 AI profile 的 `targetBpm + bpmOffset` 和 `difficulty` 生成视觉划水节奏，只调用 `Swimmer.playAiStrokeVisual(type)` 触发水花和肢体表现。
- `difficulty` 现在主要影响视觉节奏的抖动和偶发左右错误，不再直接影响稳定性得分。
- `bpmOffset` 现在主要影响 AI 动作表现频率，不再作为速度结算的输入节奏。
- AI 跳水不是由 `AISwimmerController` 触发，而是在 `GameFlowController` 的 `DIVING` 阶段统一调度：
  - `diveReaction` 越低，反应延迟越短。
  - `divePower` 越高，跳水 power 越高。
  - 每个 AI 都会独立 `prepareDive()` 和 `performDive()`，不会等待玩家松手。
- 每条 AI 泳道配置了不同参数：
  - `difficulty`
  - `bpmOffset`
  - `aiPower`，作为 AI 独立推进和阻力的倍率补偿。
  - `aiMaxSpeedScale`，当前只作为轻微最高速差异，不应大幅高于玩家上限。
  - `divePower`
  - `diveReaction`
- 当前 AI 水平差距已经拉大：最强档仍保持 `aiPower = 1.05`、`aiMaxSpeedScale = 1.03` 的上限不变；最低档下调到 `aiPower = 0.75`、`aiMaxSpeedScale = 0.82`、`divePower = 0.42`、`diveReaction = 0.42`，用于营造明显落后选手。
- AI 独立推进的全局强度暴露在 debug model 调参面板里：`AI巡航加速` / `SWIMMER_BALANCE.aiCruiseAccel` / `speed.aiCruiseAccel`。
- 当前 AI 与玩家使用相同肤色，不同泳衣和泳帽颜色；主角通过描边和泳道视觉识别。

### 角色模型、蒙皮与特效

- 当前角色加载路径只保留低模：
  - `models/UserSwimmerLow`
  - `models/UserSwimmerLow/UserSwimmerLow`
- `character/CharacterRig.ts` 定义了当前角色表现层的公共接口，后续替换人物模型时应优先适配该接口。
- `character/CharacterModelLoader.ts` 负责：
  - 加载泳手 prefab。
  - 递归查找节点/组件。
  - 统一配置 `SkinnedMeshRenderer` 的实时骨骼渲染。
- `character/FreestylePoseController.ts` 负责：
  - 绑定关键骨骼。
  - 捕获和恢复基础骨骼姿态。
  - 应用自由泳手臂、腿部和上半身滚转姿态。
  - 应用模型 debug 姿态和赛前站姿。
  - 为水花系统提供手脚骨骼世界坐标。
- `CartoonSwimmerRig` 仍是当前 Cocos 组件外壳，实例化 prefab 后会：
  - 查找 `Armature` 作为骨骼根。
  - 初始化 `FreestylePoseController`。
  - 收集 `SkinnedMeshRenderer`。
  - 强制 `skinningRoot = this._model`。
  - 关闭 baked animation 上传，保持实时骨骼可控。
  - 捕获初始骨骼姿态，后续用相对旋转驱动动作。
- `CharacterAnimationPlayer` 已从 `CartoonSwimmerRig` 中拆出，负责 `SkeletalAnimation` 绑定、`FreestyleFull` 选择、播放、停止和动画 state speed 控制。
- 如果模型自带 `FreestyleFull` 动画，运行时优先播放动画并按速度调节 animation state speed。
- 如果没有合适动画，代码可以退回到手动骨骼驱动：
  - `FREESTYLE_ARM_POSES` 采样手臂关键姿势。
  - `applyLeg` 模拟自由泳打水。
  - `applyUpperBodyRoll` 模拟身体滚转。

### 角色外观

- 低模角色目前走运行时贴图方案，不额外增加衣服网格。
- `character/CharacterSkinApplier.ts` 负责材质、运行时贴图和描边 shell。
- 运行时贴图为 `128x128` RGBA：
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
- `CharacterSkinApplier` 为每个 `SkinnedMeshRenderer` 复制一个描边 shell。
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
- `character/SplashEmitter.ts` 负责 `splashNode`、水花材质加载、水花强度计算，以及手/脚骨骼位置跟随。
- `CartoonSwimmerRig` 每帧只把当前手脚接水状态、动作强度和速度同步给 `SplashEmitter`。
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
- 自动镜头现在按比赛阶段组织：
  - 倒计时开始时，相机以主角为圆心，从当前面向运动员的机位绕到运动员背后，过程中始终看向主角，并逐步缩短距离。
  - 玩家松开起跳后，`GameFlowController` 会调用 `RaceCameraDirector.startDiveShot()`，自动镜头切入第一人称，视线朝向泳池终点，并持续约 2-3 秒。
  - 第一人称结束后，镜头从主角正后方开始，一边拉远，一边沿弧线平滑转到正侧视角。
  - 正式游泳过程默认保持正侧视跟随，便于看清划水节奏和前进速度。
  - 临近终点时保留当前俯视终点逻辑，帮助观察触壁和完赛。
- `GameManager` 每帧只向 `RaceCameraDirector` 提供比赛快照：
  - 玩家 x 坐标。
  - 玩家距离。
  - 最近 AI 距离差。
  - 是否倒计时。
  - 是否比赛中。
- 模型调试模式可用于只看主角动作：
  - A/D 触发左右对角肢体动作。
  - Q/E 调慢或调快动作速度。
  - 鼠标拖拽环绕，滚轮缩放。

### 模型调试模式与手感参数面板

模型调试模式已经不仅是“看动作”的入口，现在也是主要的手感调参入口。入口在开始页的 `MODEL DEBUG` 按钮，流程由 `app/ModelDebugFlowController.ts` 协调，HUD 由 `ui/ModelDebugHudBuilder.ts` 构建，参数描述和保存逻辑集中在 `core/TuningDebugControls.ts`。

#### 调试模式输入与实时反馈

- Debug model 模式下仍使用与比赛一致的输入语义：
  - `A`：左手划一圈水 + 右脚打一次水。
  - `D`：右手划一圈水 + 左脚打一次水。
  - `A + D`：在合并窗口内按下会触发 `StrokeType.BOTH`，即左右手和左右脚同时动作。
  - `Q / E`：调整比赛和 debug model 共用的整体动画倍率；不改变比赛物理速度，但会影响比赛动作播放速度。
  - 鼠标拖拽：环绕观察模型。
  - 鼠标滚轮：缩放观察距离。
- Debug model 顶部会显示与比赛 HUD 类似的即时反馈：
  - 当前评分：`READY` / `PERFECT` / `GOOD` / `BAD`。
  - 当前 combo。
  - 当前模拟泳速：`m/s` 和相对 `SWIMMER_BALANCE.maxSpeed` 的百分比。
- Debug model 不再复制一套评分转换逻辑，而是和比赛模式共用 `core/StabilityScoring.ts`：
  - `SwimmerMotor` 负责动作队列、速度、稳定性和 `badReason` 计算。
  - `StabilityScoring` 负责把稳定性结算转换为 `PERFECT / GOOD / BAD`、combo 和统一日志格式。
  - 这样调参时看到的评分、combo、`badReason` 日志与比赛模式口径一致。
- Debug model 的速度显示使用一份独立的 `SwimmerMotor` 模拟：
  - 该 motor 只用于显示速度，不移动角色节点。
  - 它复用 `SwimPhysicsModel`、动作队列、稳定性、输入新鲜度和交替质量等同一套速度模型。
  - 目的是在不进入比赛、不移动模型位置的情况下，能看到当前参数对速度曲线的大致影响。
  - Debug 速度模拟仍会受 `SWIMMER_BALANCE`、`INPUT_TUNING`、`STABILITY_TUNING`、`MOTION_TUNING` 当前值影响。

#### 调参面板位置与操作

- 调参面板固定在 debug model 左侧，避免遮挡右侧观察模型的主要视角。
- 面板顶部显示当前参数分组，使用 `<` / `>` 切换分组。
- 每个参数行包含：
  - 中文参数名。
  - 一句中文说明。
  - 当前数值。
  - `-` / `+` 两个调整按钮。
- 参数调整会立即写入运行时配置对象，因此 debug model 的评分、速度和动作表现会立刻反映变化。
- 面板底部有两个关键按钮：
  - `重置`：把所有可调参数恢复到代码初始默认值，并刷新当前面板。重置只影响当前运行时值，不自动覆盖已保存配置。
  - `应用`：开发调试时把当前所有调参值写入项目内明文 JSON 配置，之后游戏启动时会读取这份参数。
- 当前代码默认值已经同步为最近一次确认满意的项目配置值。如果之后想把新的调参结果变成正式默认值，需要先点 `应用` 保存项目配置，再把 `tuning.json` 的 `values` 同步回 `GameBalance.ts` / `InputTuning.ts` 的默认常量。
- 项目配置路径固定为 `assets/resources/config/tuning.json`，这是最终运行时优先读取的配置。
- 在编辑器预览中点击 `应用` 会尝试通过编辑器/Node 能力写入项目配置文件；如果当前预览环境没有写项目文件权限，面板会明确提示只临时保存到了 `localStorage`。
- 原生运行环境仍保留 Cocos writablePath 作为备选保存位置；`localStorage` 只作为无法写文件时的临时 fallback。
- JSON 文件包含：
  - `version`：配置格式版本。
  - `updatedAt`：最后一次点击 `应用` 的保存时间。
  - `values`：真正参与读取和应用的参数值。手动配置时主要改这里。
- 项目配置当前只持久化 `values`，避免编辑器预览写入中文说明时出现编码导致的非法 JSON。中文名、说明、范围和步进仍由 `TuningDebugControls.ts` 提供并显示在 debug model 面板里。
- `GameManager.onLoad()` 会调用 `loadSavedTuningAsync()`，在场景和比赛逻辑创建前优先读取项目配置资源。

#### 参数分组

`TuningDebugControls.ts` 当前把可调参数分为 5 组，每组都通过统一的 `TuningControl` 描述：

- `输入`
  - `触摸防连点`：`INPUT_TUNING.padStrokeDedupeMs`。过滤同侧 touch/mouse 重复派发。
- `跳水`
  - `最低跳水`：`DIVE_BALANCE.minPower`。没有蓄力或蓄力条很低时保留的最低跳水力度。
  - `蓄力周期`：`DIVE_BALANCE.chargeCycleSeconds`。蓄力条从 0 到 1 再回到 0 的完整周期。
- `速度`
  - `基础速度`：`SWIMMER_BALANCE.baseSpeed`。进入游泳阶段时的初始速度。
  - `最高速度`：`SWIMMER_BALANCE.maxSpeed`。玩家常规游泳速度上限，也用于计算当前速度比例。
  - `基础动作加速`：`SWIMMER_BALANCE.strokeBaseAccel`。每轮动作真正开始播放时给的基础加速度。
  - `稳定加速`：`SWIMMER_BALANCE.strokeStabilityAccel`。稳定性为 1 时额外附加的加速度。
  - `加速持续`：`SWIMMER_BALANCE.strokeAccelDurationRatio`。一次动作加速度持续时间，占当前动作一轮时间的比例。
  - `交替样本轮数`：`SWIMMER_BALANCE.alternationWindowSize`。用于计算左右交替质量的最近动作轮数。
  - `单侧基础保底` / `单侧稳定保底`：只按单侧时基础动作加速和稳定加速保留的比例。
  - `泳池减速`、`基础阻力`、`高速阻力`：当前速度模型中的三类减速参数。
  - `AI巡航加速`：`SWIMMER_BALANCE.aiCruiseAccel`。AI 对手独立于玩家输入评分的持续推进加速度，只影响 AI。
  - `P连击间隔`：`SWIMMER_BALANCE.perfectComboBoostInterval`。每多少个 Perfect combo 触发一次超速奖励，0 表示关闭。
  - `P奖励速度`：`SWIMMER_BALANCE.perfectComboSpeedBonus`。触发里程碑时直接加到当前速度上的奖励。
  - `P超速上限`：`SWIMMER_BALANCE.perfectComboMaxOvercap`。Perfect combo 奖励最多允许超出最高速度多少。
  - `P超速衰减`：`SWIMMER_BALANCE.perfectComboOvercapDecay`。临时超速上限每秒下降多少。
- `稳定性`
  - `样本轮数`：`STABILITY_TUNING.sampleWindowSize`。稳定性计算使用最近多少轮动作的按住比例。
  - `完美波动`：`STABILITY_TUNING.perfectStdDev`。最近样本按住比例标准差小于等于此值时，波动评分为满分。
  - `失稳波动`：`STABILITY_TUNING.badStdDev`。最近样本按住比例标准差达到此值时，波动评分降到 0。
  - `最短长按`：`STABILITY_TUNING.minHoldSeconds`。本轮按住时间低于这个秒数时，稳定性直接算 0。
  - `最低有效比例` / `最高有效比例`：限制极短按或几乎全程按住拿满稳定性。
  - `提前宽容`：`STABILITY_TUNING.inputFreshnessGraceRatio`。输入进入缓存后，等待时间占本轮动作时间低于这个比例时不惩罚。
  - `提前惩罚`：`STABILITY_TUNING.inputFreshnessPenaltyRatio`。超过提前宽容后，新鲜度从 1 平滑降到最低值所需的额外比例。
  - `最低新鲜度`：`STABILITY_TUNING.inputFreshnessMinScale`。输入过早缓存时仍保留的最低收益比例。
  - 当前默认 `提前宽容 = 0.08`、`提前惩罚 = 0.35`、`最低新鲜度 = 0.05`；这是为了让快速 AD 连打更快暴露为低新鲜度。
- `动作`
  - `按住速度`：`MOTION_TUNING.heldMotionSpeedScale`。按键按住时动作播放倍率。
  - `松开速度`：`MOTION_TUNING.releasedMotionSpeedScale`。松开按键后剩余动作追完的倍率。
  - `手臂最低`：`MOTION_TUNING.armMinCyclesPerSecond`。比赛中手臂动作最低每秒循环数。
  - `腿部最低`：`MOTION_TUNING.kickMinCyclesPerSecond`。比赛中打腿动作最低每秒循环数。
  - `动作上限`：`MOTION_TUNING.maxCyclesPerSecond`。比赛中手脚动作最高每秒循环数。
  - `动画倍率`：`MOTION_TUNING.animationSpeedScale`。比赛和 debug model 共用的整体动画倍率；debug model 底部 `Speed`、`Q / E` 和调参面板修改的都是这个参数，点击 `应用` 后会持久化。

#### 参数读取与维护边界

- `GameBalance.ts` 中保留历史 `TARGET_INTERVAL` 常量，但动态逻辑应优先使用 `getTargetInterval()`，这样 `targetBpm` 调整后能实时生效。
- `InputTuning.ts` 中保留历史 `TARGET_LIMB_RATE` 常量，但动态逻辑应优先使用 `getTargetLimbRate()`。
- `SwimmerMotor`、`SwimPhysicsModel`、`AISwimmerController`、`CharacterDebugController` 和 debug model 评分日志当前都已经改为读取运行时参数；AI 速度层现在读取 `SWIMMER_BALANCE.aiCruiseAccel`，不读取玩家稳定性评分。
- 新增手感参数时应优先：
  1. 放入 `GameBalance.ts`、`InputTuning.ts` 或相关专门配置对象。
  2. 确保逻辑代码读取运行时对象或 getter，而不是在模块顶部缓存派生值。
  3. 在 `TuningDebugControls.ts` 增加一条 `control(...)`，写清楚中文名称、说明、步进、范围和精度。
  4. 如果参数影响比赛模式，也要确认 `loadSavedTuning()` 在启动时能覆盖默认值。
- 当前 `resetTuningToDefaults()` 恢复的是代码加载时的默认参数快照；`saveCurrentTuning()` 保存的是当前所有 `TuningControl` 的值，并生成只包含 `version`、`updatedAt`、`values` 的项目配置 `assets/resources/config/tuning.json`。
- 当前 `values` 使用显式参数 id 作为 key，例如 `speed.strokeBaseAccel`、`motion.animationSpeedScale`，避免未来重排列表后旧配置映射错位。

### 当前工程结构

当前结构已经从单个 `GameManager` 集中实现，拆成以下主要模块：

```text
assets/scripts/
  app/
    RuntimeSceneBuilder.ts # Canvas/UI 摄像机、3D 摄像机、灯光、运行时节点清理
    GameFlowController.ts  # 开始、重开、回开始页、RaceManager 回调和 AI 流程协调
    ModelDebugFlowController.ts # 模型 debug 进入/退出、debug 摄像机、动作速度控制、评分和速度模拟

  core/
    GameManager.ts        # 启动、流程协调、运行时模块创建
    RaceManager.ts        # 倒计时、玩家跳水、比赛计时、进度、完赛回调
    GameBalance.ts        # 比赛距离、速度、跳水和 AI 节奏配置
    InputTuning.ts        # 节奏评分窗口、输入频率窗口和输入去重配置
    ResourcePaths.ts      # resources 路径和动画 clip 名配置
    InputManager.ts       # 键盘/鼠标/触摸输入入口
    InputRouter.ts        # 游戏输入事件、跳水事件和 debug 摄像机事件路由
    StabilityScoring.ts   # 稳定性评分转换、combo 更新和比赛/debug 共用日志格式
    TuningDebugControls.ts # debug model 手感调参项、默认值恢复、应用保存和启动读取
    DebugLogController.ts # debug 日志缓存、面板绑定和显示开关
    RhythmEvaluator.ts    # 节奏判定
    WaterSurface.ts       # 水面节点轻动画

  swimmer/
    StrokeMetrics.ts      # 手/腿输入频率、effort、sync
    SwimPhysicsModel.ts   # 速度、阻力和 AI 加成
    SwimmerMotor.ts       # 距离、速度、动作 cycle、比赛状态

  competitor/
    CompetitorConfig.ts   # AI profile 和选手视觉配置
    SwimmerFactory.ts     # 创建单个泳手和 rig
    CompetitorManager.ts  # 创建玩家、AI 列表和主 AI

  character/
    CharacterAnimationPlayer.ts # 角色动画 clip 选择、播放、停止和速度控制
    CharacterDebugController.ts # 模型 debug 动作输入频率、动作相位和调试姿态驱动
    CharacterRig.ts        # 角色表现层公共接口
    CharacterModelLoader.ts# prefab 加载、节点/组件查找、skinned renderer 配置
    CharacterSkinApplier.ts# 动态贴图、材质、描边 shell
    FreestylePoseController.ts # 自由泳骨骼姿态、基础姿态、赛前/debug 姿态
    SplashEmitter.ts       # 水花节点、材质、强度和骨骼跟随

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
    ModelDebugHudBuilder.ts # 模型 debug HUD、实时评分/速度、调参面板和重置/应用按钮
    DebugPanelBuilder.ts
    UIController.ts       # UI 数据刷新和动画反馈
    UIFlowController.ts   # 开始页、比赛 HUD、模型调试 HUD 和比赛提示显隐流程

  entity/
    Swimmer.ts            # Cocos 门面组件，连接 motor 和表现
    AISwimmerController.ts
    CartoonSwimmerRig.ts  # 当前角色表现外壳，协调模型/姿态/水花/debug
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

当前状态：

- 已经建立 debug model 手感调参面板，入口在开始页 `MODEL DEBUG`。
- 可调参数已按 `输入 / 跳水 / 速度 / 稳定性 / 动作` 分组，并带中文名称和说明。
- 调参时当前运行时立即生效，便于看动作、评分和模拟速度反馈。
- `重置` 可恢复代码默认值，`应用` 会优先写入项目配置 `assets/resources/config/tuning.json`，游戏启动时由 `GameManager.onLoad()` 读取保存值；无法写项目文件时会明确提示 fallback 到 localStorage。
- Debug model 中已显示比赛口径的 `PERFECT / GOOD / BAD`、combo 和模拟泳速。
- `SwimmerMotor`、`SwimPhysicsModel`、`StabilityScoring` 和动作播放速度已经改为读取运行时配置，避免调参后仍使用旧缓存值。

后续仍可增强：

- 在 debug model 或单独练习模式中展示更细的物理拆分：
  - 当前手频率。
  - 当前腿频率。
  - effort score。
  - sync score。
  - combo bonus。
  - drag 和 accel。
  - 最大速度倍率来源。
- 给保存参数增加导出/导入文本，方便多人协作调参。
- 调参参数已经使用显式 id；后续新增参数时继续使用稳定英文 id。
- 调整起步阶段逻辑，确保玩家能通过对角肢体输入起步，但想冲高速必须稳定左右交替。

验收标准：

- 新玩家能在 2 到 3 局内理解交替输入。
- 高手能通过稳定节奏明显领先 AI。
- 速度曲线不会突然爆炸或无故掉速。
- Debug model 调参后，比赛模式读取保存参数，且调参反馈与比赛实际手感一致。

### 4. UI 与比赛反馈

目标：让玩家知道自己为什么快、为什么慢、什么时候赢。

实现细节：

- 增加进度条或泳道小地图，显示玩家和主要 AI 的相对位置。
- rating 文案保留 `PERFECT / GOOD / BAD`，但增加颜色和动画区分。
- 在比赛结束面板展示：
  - 完赛时间。
  - 当前名次。
  - 最长 combo。
  - 平均速度。
  - Perfect/Good/Bad 次数。
- 移动端触摸区保持左右半屏不可见命中区，不显示 `LEFT / RIGHT` 或肢体说明等提示文字。

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
  - Easy：AI 视觉节奏抖动较大，偶尔重复同侧，`aiPower` / `aiMaxSpeedScale` 略低。
  - Normal：当前参数附近。
  - Hard：AI 视觉节奏更稳定，`aiPower` / `aiMaxSpeedScale` 略高，但仍保留随机表现失误。
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
  - `character/CharacterModelLoader`
  - `character/CharacterSkinApplier`
  - `character/FreestylePoseController`
  - `character/SplashEmitter`
  - `app/RuntimeSceneBuilder`
  - `app/GameFlowController`
  - `app/ModelDebugFlowController`
  - `ui/*Builder`
- 后续继续拆分：
  - `SceneBootstrap`：如后续需要更完整启动流程，可包一层 `RuntimeSceneBuilder`、资源预热和流程 controller 初始化。
  - `CharacterPoseStateController`：进一步收拢赛前站姿、跳水、游泳和结束姿态切换。
- 核心游戏参数已集中到 `GameBalance.ts`，后续新增玩法参数应优先进入该配置。
- 资源路径已集中到 `ResourcePaths.ts`，后续新增 resources 路径不要散落在 loader 里。
- 为核心逻辑补充单元测试或轻量脚本测试：
  - `RhythmEvaluator`
  - `Swimmer` 速度公式
  - AI 输入节奏

## 技术债与注意事项

- `GameManager.ts` 已拆出基础场景 setup、比赛流程协调、模型 debug 流程、输入路由、UI flow 和 debug panel 日志，但仍承担运行时 UI 构建入口和少量 UI/Race/Camera 转发。后续可继续包一层更薄的 `SceneBootstrap`。
- `CartoonSwimmerRig.ts` 已拆出模型加载、皮肤/描边、自由泳骨骼姿态、水花 emitter、动画 clip 播放控制和模型 debug 动作控制，但仍混合赛前/跳水/游泳/结束姿态切换和角色外壳流程。后续可继续拆出 `CharacterPoseStateController`。
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
