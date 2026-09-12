# PERFECT 判定影响项调查

## 修正记录（玩法版本 27）

2026-09-12 经用户确认，已完成以下修正：

- 三个入口、玩家和 AI 共用基础轮速，移除所有入口轮速倍率及调参项；旧本地保存中的对应键不再生效。AI 策略仍使用最高档，调试入口仍关闭转向。
- 移除身体发黄关联的隐藏末端宽容，以及对应参数和标记。当前基础 PERFECT 固定为 25%～50%，超过 50% 不再获得隐藏 PERFECT。
- 同侧回收后续划继承已完成的起手识别时间，最多继承 `minHoldSeconds`；额外回收等待不会进入新划时长和推进预算。续划在完整 25%～50% 区间内可正常判 PERFECT。
- 保留速度驱动轮速、现有基础/质量推进和时间补偿。三个入口在 2 m/s 固定内部速度下的 PERFECT 时间宽度均约 132 ms。
- 网络协议升至 27，拒绝与 26 及更旧版本混跑；不新增网络字段。身体发光关闭时不再进行相关的每帧查询。

新增回归覆盖了三个入口、左右手、低中高速度下的同侧续划完整区间与区外边界，以及旧本地调参加载。专项分析脚本已更新为校验修正后的行为。

**以下为修正前的调查快照，用于解释问题来源；其中的入口差异、末端宽容和续划异常已经修正。**

核查日期：2026-09-12。调查基于当时工作区代码和 `assets/resources/config/tuning.json`。

当前基础 PERFECT 是完整动作周期进度的 **25%～50%**，含两端。速度不移动这两个进度边界，但会改变经过它们所需的时间。心率已经退出判定。除此以外，仍存在按住分类、模式轮速、末端容错及同侧回收续划计时等影响。

## 当前有效参数

| 参数 | 项目保存值 | 实际作用 |
| --- | --- | --- |
| `strokeQuality.perfectStart` / `perfectEnd` | 0.25 / 0.50 | 基础 PERFECT 进度范围，整段都判满质量 |
| `strokeQuality.goodStart` / `goodEnd` | 0.15 / 0.60 | GOOD 范围，同时约束 PERFECT 不能越出它 |
| `gesture.armStrokeTimeoutProgress` | 0.60 | 按住到 60% 自动超时 BAD，也是 HUD 弧线显示终点 |
| `strokeQuality.minHoldSeconds` | 0.20 秒 | 输入由短按踢腿升级为手臂划水的等待；结算还会再检查一次 |
| `strokeQuality.armCycleLowSpeedPerSecond` / `armCycleHighSpeedPerSecond` | 1.8 / 2.0 | 低速、高速时的基础动作轮速 |
| `strokeQuality.armCycleSpeedStart` / `armCycleSpeedFull` | 1 / 3 m/s | 内部速度在 1～3 m/s 时，动作轮速从 1.8 线性升到 2.0；两端封顶 |
| `motion.heldMotionSpeedScale` | 1.0 | 按住阶段轮速倍率，直接改变 PERFECT 的实际时间宽度 |
| `motion.releasedMotionSpeedScale` | 1.3 | 松手后回收轮速，影响同侧下一划何时能够开始 |
| 三个入口的 `armCycleSpeedScale` | 1 / 0.84 / 1 | 调试、竞技、世锦赛玩家轮速；所有真正 AI 均用世锦赛倍率 |
| `strokeQuality.perfectVisualReleaseGraceSeconds` | 0.08 秒 | 末端宽容的时间上限，另受硬编码的 +0.03 进度上限约束 |

配置加载也有约束：`TuningDebugControls` 会将 GOOD 限制在超时进度内，再将 PERFECT 限制在 GOOD 内；AI 最大松手进度若达到超时点，会将超时点调到 AI 最大松手进度之后。因此更改 GOOD、超时参数可能间接修正 PERFECT 边界。当前保存值没有触发范围收缩。

源码默认的 PERFECT 是 0.34～0.46，启动加载项目保存配置后才变为 0.25～0.50。若本机调试保存的时间戳更新，启动会选它而非项目文件；本次没有读取用户正在运行的游戏存储。

## 速度与实际时间

基础轮速：`1.8 + 0.2 × clamp((内部速度 - 1) / 2, 0, 1)`。

实际按住轮速 = 基础轮速 × 入口倍率 × 按住动作倍率。条件系统的轮速修正目前恒为 1。调试慢动作还会缩放模拟时间。

普通新起划、内部速度恒定、正常时间倍率、没有同侧回收等待时：

| 内部速度 | 调试/世锦赛：从按下到 PERFECT | PERFECT 持续时间 | 竞技：PERFECT 持续时间 |
| --- | --- | --- | --- |
| ≤1 m/s | 约 339～478 ms | 139 ms | 165 ms |
| 2 m/s | 约 332～463 ms | 132 ms | 157 ms |
| ≥3 m/s | 约 325～450 ms | 125 ms | 149 ms |

表内起止时间包含前面的 200 ms 输入分类等待，不包含逐帧输入延迟和末端宽容。真实比赛中速度在同一划内也会变化，代码每步重新计算轮速，不会把按下瞬间的速度固定到松手。

轮速读取 `SwimmerMotor._currentSpeed`。HUD 速度读取 `Swimmer.movementSpeed`，按实际水平位移计算，两者不是同一个值。因此打转、碰撞等情况下，不应直接用 HUD 数字套上表来推算实际窗口。

## 已不直接参与的因素

- 心率：`conditionQualityScale()` 恒为 1，Motor 的 `setConditionQualityScale()` 是空实现，无法缩窄/放宽 PERFECT。
- 体力比例：`energyDepletionCadenceScale()` 恒为 1，没有低体力逐步减慢动作机制。耗尽后推进变弱，仍可能通过改变内部速度间接改变时间窗口。
- 技巧、爆发力、等级、体重、蓄气：没有直接修改 PERFECT 端点的代码。影响推进、速度或碰撞的属性可能间接影响动作轮速。
- 左右交替、连续节奏一致性、输入新鲜度、连击：不直接参与当前单划基础质量计算。双手同时按住会影响下面的容错标记条件。
- PERFECT 时间补偿、GOOD 推进倍率：改变结算推进收益，不改变基础 PERFECT 判定边界。

## 发现的遗留问题

### 1. 三个入口的玩家手感尚未统一

AI 已统一最高档，但竞技入口的玩家仍为 0.84 倍动作轮速，相同内部速度下 PERFECT 时间窗口长约 19%。调试入口调好的直线节奏不能原样代表竞技入口。

### 2. 旧的发黄宽容仍生效，而且与当前显示脱节

超过 PERFECT 终点后，要继续判 PERFECT，必须同时满足：

1. 当前进度不超过 `min(GOOD终点, PERFECT终点 + 0.03)`，当前最多到 53%。
2. 本划曾记录过 `perfectGuidePresentedAt`。
3. 距离最近一次记录不超过 80 ms 模拟时间。
4. 长按时间仍有效，且未超时结算。

这不是无条件增加 80 ms。调试/世锦赛当前轮速下，额外 3% 进度最多约 15～17 ms；能否实际获得，还取决于最近一次标记的时刻。

标记来自 `Swimmer.updatePerfectZoneGlow()`，而非当前手掌 HUD 真正显示出的帧。仅一只手按住时检查该手；两只手都按住时，要求两手都在基础 PERFECT 区内才标记。真正 AI 不走此标记路径。

`PerformanceConfig` 已将身体发黄效果关闭，但标记动作发生在视觉开关判断之前，容错仍可能触发。因此“黄色松手宽容”的调参说明与现实现状不一致，HUD 绿色区外也可能判 PERFECT。

### 3. 同侧回收续划会重置计时，导致绿色区前半段不算 PERFECT

若上一划还在回收，本次长按已升级但起划请求被占用拒绝，玩家继续按住，回收完成后 `tryStartHeldStroke()` 会自动开始新划，同时把 `pressedAt` 重置为新划开始时间。

普通起划继承了输入分类阶段的 200 ms；这条续划路径没有继承。结算却仍要求新 `pressedAt` 起算满 200 ms，而 HUD 和 `isActiveStrokeInPerfectZone()` 都只看动作进度。

已用真实 Motor 复现，内部速度固定 2 m/s、调试入口：

| 续划松手位置 | 界面基础 PERFECT | 结算长按时长 | 实际结果 |
| --- | --- | --- | --- |
| 30% | 是 | 约 159 ms | 降级为踢腿，质量 0 |
| 40% | 是 | 约 212 ms | PERFECT |

按连续时间估算，这条路径在 2 m/s 时要到约 38% 才满足长按门槛，基础有效范围约为 38%～50%；普通起划仍是 25%～50%。这不是主动设计的难度曲线，而是两条计时路径不一致。

## HUD 显示口径

内部判定的 100% 表示完整动作周期；HUD 弧线的终点对应超时点 60%。因此当前绿色区在可见弧线的约 **41.7%～83.3%** 位置，不能将画面弧线百分比直接当成参数百分比。

绿色区来自同一套基础判定的 96 段采样。当前 25% 和 50% 恰好落在采样边界，显示没有这类量化偏差；任意其他端点可能有约半个采样格的误差。显示不包括末端宽容，也没有排除上面续划路径中未满 200 ms 的部分。

## 无效的旧参数

`InputTuning.INPUT_TUNING` 中以下字段仅保留定义，全项目无读取者：

- `rhythmPerfectWindowSeconds`、`rhythmGoodWindowSeconds`、`rhythmLooseWindowSeconds`
- `bothRhythmPerfectWindowSeconds`、`bothRhythmGoodWindowSeconds`
- `holdPerfectWindowSeconds`、`holdGoodWindowSeconds`、`holdLooseWindowSeconds`
- `bothHoldPerfectWindowSeconds`、`bothHoldGoodWindowSeconds`

修改这些旧字段不会影响当前 PERFECT。旧 `strokeQuality.qualityZoneScaleStrength` 也只存在于废弃参数键列表中。

## 核查方法与代码位置

全项目检索字段消费者，并沿输入分类、真实动作结算、条件修正、配置覆盖与 HUD 显示核对。专项脚本加载真实模块和项目保存配置，完成 72 项断言：模式/速度、完整区间边界、末端宽容双重限制、条件修正失效、同一划内实时变速，以及同侧续划计时问题。

复查命令：`npx.cmd --yes --package typescript@5.4.5 -c "node scripts/analyze-perfect-window.cjs"`。结果写到 `temp/perfect-window-audit.json`。这是离线逻辑核查，未启动 Creator，未做真机视觉测试。报告中的数值是当前配置快照，后续改参应重新运行并更新结论。

关键代码：

- `assets/scripts/swimmer/SwimmerMotor.ts`：`_effectiveReleaseRanges`、`settleActionStrokeQuality`、`currentActionCycleSpeed`、`tryStartHeldStroke`、`buildGuideFromAction`。
- `assets/scripts/core/InputRouter.ts`：`beginPress`、`promoteIfDue`。
- `assets/scripts/core/ConditionBalance.ts`：两个恒为 1 的条件修正函数。
- `assets/scripts/entity/Swimmer.ts`：`updatePerfectZoneGlow`、`movementSpeed`。
- `assets/scripts/ui/RaceStrokeView.ts`：`updateSide`。
- `assets/scripts/core/TuningDebugControls.ts`：`loadSavedTuningAsync`、范围规范化与旧键迁移。

原始调查阶段没有修改单机或联机判定；随后按用户确认完成了本文开头列出的版本 27 修正。
