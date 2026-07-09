# tuning.json 调参说明

本文说明 `assets/resources/config/tuning.json` 里每个数值的含义。游戏启动时会通过 `GameManager.onLoad()` 读取这份配置，并覆盖代码默认值。

说明里的“当前值”来自本文编写时的 `tuning.json`。如果之后在调试面板保存过参数，请以文件里的最新值为准。

## 基本结构

- `version`：调参文件格式版本，目前是 `3`。
- `updatedAt`：最近一次保存时间，ISO 字符串，只用于记录。
- `values`：真正参与运行的调参键值表。

## 输入

| 键 | 当前值 | 单位 | 含义 |
| --- | ---: | --- | --- |
| `input.padStrokeDedupeMs` | `5` | ms | 同一侧触摸或屏幕按钮重复触发的过滤时间。只影响触摸/按钮输入，不影响键盘 `A`/`D`。调大可以减少误连点，调小会让快速连续触摸更容易被接受。 |

## 跳水

| 键 | 当前值 | 单位 | 含义 |
| --- | ---: | --- | --- |
| `dive.minPower` | `0.3` | 比例 | 没有蓄力或蓄力条很低时保留的最低跳水力度。值越高，失误跳水也会更快、更远。 |
| `dive.chargeCycleSeconds` | `2.5` | s | 蓄力条从 `0 -> 1 -> 0` 的完整周期。值越小越难抓满蓄力，值越大节奏越宽松。 |
| `dive.underwaterHoldSeconds` | `2` | s | 跳水入水后保持水下滑行深度的时间。这段时间里手臂划水被限制，主要允许踢腿推进。 |
| `dive.underwaterRiseSeconds` | `1.35` | s | 水下阶段从深度回升到水面的时间。上浮结束后恢复正常手臂划水。 |
| `dive.straightenRatio` | `0.35` | 比例 | 水下保持阶段里，把入水斜下姿态拉回水平所用时间占比。越小越早变水平，越大斜下姿态保持更久。 |
| `dive.underwaterRiseTilt` | `12` | 度 | 上浮阶段身体斜上抬头的最大角度，到达水面时回到水平。只影响上浮姿态表现。 |

## 速度与物理

速度更新在 `SwimPhysicsModel` 中计算，核心关系是：

```text
drag = poolDeceleration + baseDrag * speed + highSpeedDrag * speed * speed
nextSpeed = currentSpeed + (accel - drag) * dt
```

手臂划水推进接近最高速度时还会被 `accelLimit` 压低；踢腿推进有自己的踢腿速度上限。

划水推进会按本次动作占用时间做补偿，避免“早松 GOOD 因为频率更高反而更快”的套利：

```text
timeScale = 本次划水预计总耗时 / 甜区中心划水预计总耗时
strokeAccel = (基础动作加速 + 划水质量加速 * 甜区质量) * timeScale
```

因此早松虽然能更快进入下一次划水，但本次单次推进也会按时间缩短；按单位时间看，甜区质量更高的位置收益最高。

| 键 | 当前值 | 单位 | 含义 |
| --- | ---: | --- | --- |
| `speed.baseSpeed` | `0.8` | m/s | 进入正常游泳阶段时的初始速度。跳水入水速度由跳水结果决定，不直接用这个值。 |
| `speed.maxSpeed` | `6` | m/s | 玩家常规游泳速度上限，也用于计算当前速度比例。速度越接近这个值，手臂推进越会被压低。 |
| `speed.strokeBaseAccel` | `0.5` | m/s² | 每次手臂划水动作开始播放时给的基础推进加速度，与松手时机无关。它不是直接增加速度，而是一段持续的加速度脉冲。 |
| `speed.strokeStabilityAccel` | `3` | m/s² | 甜区评分带来的额外推进加速度。松手正中甜区时接近满值，偏离中心会按评分比例减少，并受体能效率倍率影响。 |
| `speed.strokeAccelDurationRatio` | `0.35` | 比例 | 一次划水加速度脉冲持续时间，占当前动作一轮时间的比例。越短越像瞬间窜一下，越长越像持续推水。 |
| `speed.strokeImpulseSharpness` | `0.6` | 0-1 | 划水脉冲的前置锐度。`0` 表示加速度平均分布；越高表示划水刚触发时更猛、后段回落更快。总推进量大体不变，主要改变手感。 |
| `speed.diveUnderwaterKickAccel` | `0.4` | m/s² | 跳水入水后的潜水阶段，每次输入只触发腿部踢水时给的推进加速度。和正常比赛里的踢腿频率推进分开调。 |
| `speed.kickAccelPerHz` | `0.5` | m/s² / Hz | 正常比赛踢腿推进系数。每 1Hz 踢腿频率产生多少持续加速度；点得越快，频率越高，加速越强。 |
| `speed.kickMaxSpeed` | `3` | m/s | 单靠踢腿能达到的最高速度。应低于 `speed.maxSpeed`，让手臂划水仍是主要速度来源。 |
| `speed.kickCeilingBand` | `0.5` | m/s | 接近踢腿速度上限前的缓冲区间。速度进入 `kickMaxSpeed - kickCeilingBand` 到 `kickMaxSpeed` 之间时，踢腿加速度会逐渐衰减到 0。 |
| `speed.kickCadenceMaxHz` | `8` | Hz | 踢腿推进使用的频率上限。超过这个点击频率不会继续增加推进，防止极快连点把速度拉爆；腿部动画测量另有安全上限。 |
| `speed.kickCadenceMeasureMaxHz` | `20` | Hz | 踢腿频率测量安全阀。主要防止两次点击间隔极小时算出异常大频率；正常手速通常碰不到。腿动画会参考这个较高上限。 |
| `speed.poolDeceleration` | `0.05` | m/s² | 固定减速度，和当前速度无关。相当于泳池/场景给的基础阻滞。 |
| `speed.baseDrag` | `0.42` | 系数 | 线性阻力系数，阻力与当前速度成正比。调大后中低速也会明显掉速。 |
| `speed.highSpeedDrag` | `0.14` | 系数 | 二次阻力系数，阻力与速度平方成正比。调大后高速段更难维持，低速影响较小。 |
| `speed.aiCruiseAccel` | `1.9` | m/s² | AI 对手的持续巡航推进加速度，独立于玩家输入评分。值越高，AI 越容易保持速度。只影响 AI。 |

## 划水判定与甜区

甜区位置使用“手臂拉水弧线占整圈的比例”表示。`0` 是刚开始，`0.5` 大约是半圈末尾/出水附近。

手臂划水的每秒圈数（轮速）由当前速度在一个速度窗口内线性映射得到，两端夹住：

```text
t = clamp01((speed - armCycleSpeedStart) / (armCycleSpeedFull - armCycleSpeedStart))
cyclesPerSecond = lerp(armCycleLowSpeedPerSecond, armCycleHighSpeedPerSecond, t)
一圈时长 = 1 / cyclesPerSecond
```

速度 ≤ `armCycleSpeedStart` 时恒为下限，≥ `armCycleSpeedFull` 时恒为上限。速度上限 `speed.maxSpeed` 通常比 `armCycleSpeedFull` 更高，所以顶速之后继续加速不会再改变轮速。玩家和 AI 共用这套参数，AI 只是输入节奏不同。

| 键 | 当前值 | 单位 | 含义 |
| --- | ---: | --- | --- |
| `stability.minHoldSeconds` | `0.12` | s | 触摸/按键按住多久才从踢腿点击升级为手臂划水。短于这个值会保持为一次踢腿点击，不算划水，也不判失误。 |
| `stability.goodStart` | `0.22` | 比例 | GOOD 区间起点，范围 0..1。想让 GOOD 更早出现，就调小这个值。 |
| `stability.goodEnd` | `0.5` | 比例 | GOOD 区间终点，范围 0..1。和 PERFECT 重叠的部分按 PERFECT 计算。 |
| `stability.perfectStart` | `0.34` | 比例 | PERFECT 区间起点，范围 0..1。PERFECT 优先级高于 GOOD。 |
| `stability.perfectEnd` | `0.46` | 比例 | PERFECT 区间终点，范围 0..1。 |
| `gesture.armStrokeTimeoutProgress` | `0.5` | 比例 | 一直长按不松手时，手臂划水推进到整圈的这个比例后自动结束并判为超时失误。`0.5` 表示半圈。 |
| `gesture.armStrokeTimeoutAccel` | `0.08` | m/s² | 划水超时失误时给的很小推进加速度，用来惩罚一直按住不松手。 |
| `stability.armCycleLowSpeedPerSecond` | `0.8` | 圈/s | 速度低于 `armCycleSpeedStart` 时，手臂划水每秒转几圈（下限）。甜区判定、甜区刻度线、玩家手臂视觉动作共用这一套轮速。越低，低速时一圈越慢，甜区实际时间窗口越宽。 |
| `stability.armCycleHighSpeedPerSecond` | `2.5` | 圈/s | 速度到达 `armCycleSpeedFull` 后，手臂划水每秒转几圈（上限）。越高，高速时一圈越快，甜区实际时间窗口越短。 |
| `stability.armCycleSpeedStart` | `1.0` | m/s | 起爬速度。低于这个速度，轮速恒为下限；到达后才开始随速度线性加快。 |
| `stability.armCycleSpeedFull` | `4.5` | m/s | 顶速速度。到达这个速度轮速升到上限，再快也不再变化。必须大于 `armCycleSpeedStart`。 |

## 动作播放与姿态

这一组主要控制视觉动作、角色姿态和腿部表现。部分参数会间接影响手感，例如动作播放速度会改变玩家看到的划水节奏，但真正的速度物理由 `speed.*` 组控制。

| 键 | 当前值 | 单位 | 含义 |
| --- | ---: | --- | --- |
| `motion.heldMotionSpeedScale` | `1` | 倍率 | 按住 `A` 或 `D` 时，对应手脚动作播放的速度倍率。 |
| `motion.releasedMotionSpeedScale` | `2` | 倍率 | 松开 `A` 或 `D` 后，对应手脚把当前这一轮动作追完的速度倍率。调大后松手收动作更快。 |
| `motion.kickFlutterMaxCyclesPerSecond` | `3.2` | 圈/s | 仅 AI 使用。AI 连续打腿在最高速时的频率，AI 腿频率会随速度缩放。玩家腿已改为点击脉冲驱动。 |
| `motion.kickFlutterIdleFraction` | `0.08` | 比例 | 仅 AI 使用。AI 接近停止时保留的最低打腿频率，占最高频率的比例。 |
| `motion.kickPulseMinCyclesPerSecond` | `3.5` | 圈/s | 玩家踢腿脉冲的最低扫描频率。单点或慢点也会有一次明显快踢；连续点更快时会跟随实际频率。 |
| `motion.kickPulseMaxCycles` | `2` | 次 | 每条腿最多缓冲的踢腿次数。快速连点超过后会丢弃，值越小停点后腿停得越干脆，值越大能囤更多连续踢腿。 |
| `motion.kickSettleCyclesPerSecond` | `1.2` | 圈/s | 无输入、无划水时，腿把当前半下补完并回到直腿滑行姿势的速度。越高，收腿越快。 |
| `motion.swimBodyPitchDegrees` | `-8` | 度 | 自由泳静止和游动时整个人的基础俯仰角，用来微调头肩与腿在水里的整体角度。 |
| `motion.swimBodyYOffset` | `-0.14` | 米/本地单位 | 自由泳模型相对水面的整体高度补偿。负数会让身体更沉入水中。 |
| `motion.handPalmTurnDegrees` | `130` | 度 | 前伸入水时让掌心朝向池底的总旋前角度；旋转会分配到大臂、小臂和手腕，并在抱水/移臂阶段自动减弱。 |
| `motion.forwardArmSideClearance` | `0.3` | 本地单位 | 手臂前伸时上臂向身体外侧展开的幅度。值越大，两臂前伸时离身体侧面更远。 |
| `motion.rightBreathTurnDegrees` | `70` | 度 | 右手离水移臂时，躯干、颈部和头部向右侧旋转的总角度。 |
| `motion.rightBreathBodyRollDegrees` | `4` | 度 | 右手离水移臂时，身体额外向右侧滚转的角度，会与普通划水滚转叠加。 |
| `motion.freestyleAxisCenteringOffset` | `0.075` | 本地单位 | 自由泳身体左右滚转时给根骨的侧向补偿，主要用于俯视角下保持人物轴线贴近泳道中心。 |
| `motion.freestyleRightBreathAxisCenteringOffset` | `-0.028` | 本地单位 | 右侧换气/右手移臂时额外叠加的侧向补偿。负值会把当前偏移往反方向拉回。 |
| `motion.freestyleRightBreathHeadTurnScale` | `1.45` | 倍率 | 右侧换气时头颈扭动表现的倍率。只强调头颈，不影响身体根骨轴线和泳道居中补偿。 |

## 常见联动

- 想让玩家更容易提速：优先调高 `speed.strokeStabilityAccel` 或降低 `speed.baseDrag` / `speed.highSpeedDrag`。
- 想让速度更快掉下来：调高 `speed.baseDrag` 会影响全速段，调高 `speed.highSpeedDrag` 主要压高速段。
- 想让甜区更好打：拉宽 `stability.goodStart/goodEnd` 或 `stability.perfectStart/perfectEnd`，或降低 `stability.armCycleHighSpeedPerSecond`。
- 想让按住不松更快失败：降低 `gesture.armStrokeTimeoutProgress`。
- 想让手臂动作和甜区一起变快/变慢：调 `stability.armCycleLowSpeedPerSecond`、`stability.armCycleHighSpeedPerSecond`；想改变“从慢到快”发生在哪个速度段：调 `stability.armCycleSpeedStart`、`stability.armCycleSpeedFull`。
- 想让踢腿不抢手臂主导：保持 `speed.kickMaxSpeed` 明显低于 `speed.maxSpeed`，必要时降低 `speed.kickAccelPerHz`。

## 配置校正

加载或保存调参时，代码会做一层跨参数合理性检查：

- GOOD/PERFECT 区间会自动整理为 `start <= end`。
- GOOD/PERFECT 区间不能越过起点或超时点。
- GOOD 和 PERFECT 可以重叠，重叠部分按 PERFECT 计算。
- `stability.armCycleHighSpeedPerSecond` 不能低于 `stability.armCycleLowSpeedPerSecond`。
- `stability.armCycleSpeedFull` 必须大于 `stability.armCycleSpeedStart`，否则会被自动上移。

如果手写 JSON 配出矛盾值，运行时会自动修正并输出 `[SpeedSwimming] tuning adjusted` warning。
