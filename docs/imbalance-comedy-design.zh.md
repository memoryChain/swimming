# 泳池蛇形转向搞笑系统设计（打破直线游泳）

> 定位：**中等 · 风险回报**。竞技与搞笑并重，复刻《速度之星》"越想快越容易跑偏、想走直线要靠操作"的核心张力。
> 状态：**已实现并按实机反馈迭代多轮（tsc 通过，待编辑器/web 验证观感）**。作者视角：策划。

## 0. 实现现状（与当前代码一致）

已落地（见各模块）：

- `core/SteeringTuning.ts`（新）：`STEERING_TUNING` = turnPerStroke 14° / maxHeading 65° / turnEaseRate 3.5 / turnPowerMinFactor 0.35 / bankScale 0.25 / poolWallClearance 0.4m / aiCorrectHeadingRatio 0.3 / aiWanderChance 0.5 / useSprintSwimView(布尔)。
- `swimmer/SwimmerMotor.ts`：`_heading`/`_headingTarget` 朝向角 + `_lateralOffset` 横向偏移；`update()` 用 `forward=speed·cos` 推进、`lateral=speed·sin` 积分并钳制；`updateSteering()` 把 `heading` 平滑追 `headingTarget`（**无自动回正**）；划水**结算时**按 side×lap方向×力度施加转向（**玩家与 AI 共用同一路径**）；新增 `steeringHeadingRatio` / `correctiveStrokeSide()` 供 AI 感知偏差。
- `entity/Swimmer.ts`：`configureSteering` 对**所有人**启用转向并配泳池横向内壁范围；转发 `steeringHeadingRatio` / `correctiveStrokeSide()`；`applyCoursePosition` 每帧 前进→X + 横向→Z（钳制）+ 整体 yaw 面朝行进方向 + 入弯侧倾，并 `setCourseDirection`。
- `character/FreestylePoseController.ts` + `entity/CartoonSwimmerRig.ts`：手臂前伸方向 `_movementForwardWorld` 跟随 `heading`，不再锁死泳道方向。
- `entity/SwimmerRacePhases.ts`：翻滚转身定位带上横向偏移，避免回中心的 Z 跳变。
- `camera/RaceCameraDirector.ts` + `app/GameFlowController.ts`：玩家出水后自动切到冲刺视角（可再手动切）；冲刺相机前向紧跟、**横向慢跟**（逐轴缓动）让蛇形看得出来。
- `competitor/CompetitorManager.ts`：给每道分配 `difficulty`（AI 转向强弱由控制器按 difficulty 自行决策）。
- `entity/AISwimmerController.ts`：`pickNextSide` 按 difficulty 决定下一划水侧（AI 只控制输入，走玩家同一转向路径）。
- `core/TuningDebugControls.ts`：新增"转向"组（turnPerStroke/maxHeading/turnEaseRate/turnPowerMinFactor/bankScale/poolWallClearance/aiCorrectHeadingRatio/aiWanderChance）+ "冲刺与终点相机"组新增 sprintFollowSpeed/sprintLateralFollowSpeed；随 tuning.json 持久化。

**本版未做（待拍板）**：`bothStraightBonus`（双手同划直行强推，现在双划只是转向相互抵消=直行，不给额外推进）；撞墙只钳制不反弹（无额外反馈）；AI 选手个性的更细分支；结算彩蛋（P3）。

**待验证观感（只能编辑器预览/web 看）**：冲刺相机横向慢跟的幅度是否合适；返程 lap 左右手方向一致性；yaw/bank 正负号。

---

## 1. 设计目标

### 1.1 问题诊断
现在游泳被做成了纯竞技，根因是**人物永远沿直线前进**：

- 玩家左/右点屏 → 左/右划手，每只手自动带对侧腿（`SwimmerMotor.queueSideStroke` / `advancePlayerKicks`）。
- 但无论怎么点，人物都是一根笔直鱼雷，只有快慢、没有方向变化，观赏性为零。
- 评分只奖励"匀"（`StrokeMetrics.syncScore`），失衡毫无后果。

### 1.2 《速度之星》的搞笑来源（要复刻的本质）
好笑来自**同一套操作同时决定"快慢"与"跑向哪"**：想冲最快就得稳住方向，而人一急就乱点，一乱方向就飘，蛇形乱窜、撞来撞去。**观赏性与竞技性同源，且完全服从游戏自己的运动规律**（人一直在按速度前进，只是方向被你点歪了）——不是靠不可信的夸张动作。

### 1.3 本设计的核心主张（新方案）
> **划手不再只是加速，它同时给一个转向：右手划 → 人往左偏，左手划 → 人往右偏。想走直线，就得左右完美交替、或双手同划。**

- **视角换成冲刺视角**（背后跟拍，`RaceCameraMode.Sprint` 已存在）：从背后看，人物左右蛇形、斜着穿泳道，一目了然、极具喜感。
- **泳道绳无碰撞**，可任意穿越；唯一约束是**不能游出泳池外壁**（撞到池壁贴着滑）。
- **蛇形绕路 = 前进分量变少 = 天然变慢**（风险回报），无需额外惩罚或"翻车"状态。
- 完全符合 `AGENTS.md`：不引入自动左右交替、side 仍由触摸位置决定、不加可见左右触摸区。转向由玩家自己点出来，是涌现式搞笑。

**为什么这版更好、更靠谱**：搞笑来自**轨迹**（蛇形、斜穿、撞墙），不依赖任何定制/采样丑态动作，实现上只是给运动加一个朝向角 + 让身体转向面朝行进方向。改动集中、可靠、性能友好。

---

## 2. 核心机制：朝向角转向模型

### 2.1 状态量
给每个 Swimmer 增加一个**朝向角** `heading`（相对泳道前进方向的偏航，弧度）：

```
heading = 0     // 正对行进方向，笔直前进
heading ≠ 0     // 偏航：身体与泳道前进方向成一个夹角，不再直行
```

> 屏幕上的“左/右”由 lap 方向决定（见 §2.2），不直接绑定世界轴方向。

运动分解（把当前速度 `speed` 沿朝向拆成前进/横向两个分量）：

```
forwardSpeed = speed * cos(heading)     // 沿泳道方向的推进（决定名次进度）
lateralSpeed = speed * sin(heading)     // 横向漂移（决定在泳池里左右挪多少）
```

> **关键**：名次/进度只按 `forwardSpeed`（泳道 X 方向）累积。朝向越歪 `cos` 越小 → **蛇形自动变慢**，这就是全部竞技代价，干净自洽。

### 2.2 更新规则

**划手转向（在划水“松手/结算”时按 side 改变转向目标，逐渐转过去）**：

```
单次转向量 = turnPerStroke × 力度系数        // 力度系数∈[turnPowerMinFactor, 1]
方向 dir  = (左手? +1 : -1) × lap方向      // 保证两个半程“右手→屏幕左”一致
headingTarget += dir × 转向量
headingTarget = clamp(headingTarget, -maxHeading, +maxHeading)
// 双手同划 = 左右各一下相互抵消 ≈ 直行
```

**逐渐转向（每帧，在 `SwimmerMotor.updateSteering`）**：

```
heading += (headingTarget - heading) * turnEaseRate * dt   // 实际朝向平滑追目标
```

- **无自动回正**：`headingTarget` 不会自己衰减回 0。要扳直就得划另一侧的手（纯手动、硬核、更蛇形）。
- **转向量与发力挂钩**：单次转向量 = `turnPerStroke × 力度系数`。力度系数由**拉水行程**（`releaseProgress`，按得越久越大，封顶在划水超时行程）决定：轻点只微拐，重划（按得久）狠拐。最弱倍率 = `turnPowerMinFactor`，拉满 = 1.0。
- **触发时机**：转向发生在划水**结算（松手 / 一次划水周期完成）**那一刻，不在按下瞬间；身体随后**逐渐**转过去（由 `turnEaseRate` 控制）。
- **方向与 lap 挂钩**：右手 → 屏幕左、左手 → 屏幕右；因为冲刺相机在折返后掉头，转向冲量的世界方向**会随 lap 方向翻转**（`_courseDirection`），保证两个半程“右手→屏幕左”一致。
- **自然结果**：右、右、右连划 → 朝向持续左偏画弧；连划左手扳回。左右交替 → 在 0 附近小幅摆动、基本直行。

### 2.3 推荐初始数值（tuning，可运行时调）

| 参数 | 建议值 | 说明 |
|---|---|---|
| `steer.turnPerStroke` | `14°` | 单手划水施加的转向角 |
| `steer.maxHeading` | `65°` | 朝向角上限（避免横着甚至倒游；65° 时 `cos≈0.42`，前进只剩四成，够慢够歪但仍向前） |
| `steer.turnEaseRate` | `3.5` /s | 实际朝向追目标的平滑速率（越低转得越慢越懒） |
| `steer.turnPowerMinFactor` | `0.35` | 最短划水的转向倍率（拉满=1.0）；越小轻点与重划差别越大 |
| `steer.bankScale` | `0.25` | 入弯侧倾幅度（占朝向角比例） |

> 无自动回正：想直行就得主动左右交替。想更蛇形就调大 `turnPerStroke`。

---

## 3. 朝向对表现的分层（纯轨迹，无定制动作）

朝向角越大，轨迹越歪、越慢，看起来越滑稽。**表现全部来自"身体转向面朝行进方向 + 轨迹"**，不做任何丑态定制动作。

| 朝向 \|heading\| | 轨迹表现 | 前进系数 cos | 观感 |
|---|---|---|---|
| 0° – 10° | 基本直行，轻微左右摇摆 | ≈1.00 | 正常、专业、快 |
| 10° – 30° | 明显斜着游，缓缓横穿本泳道 | 0.98 – 0.87 | "咦有点歪" |
| 30° – 50° | 大角度斜穿，压过泳道绳进隔壁道 | 0.87 – 0.64 | 明显蛇形、开始搞笑 |
| 50° – 65° | 快要横着游，冲向池壁 | 0.64 – 0.42 | 滑稽、手忙脚乱、明显变慢 |

> 前进系数即 `cos(heading)`，是唯一的速度代价来源，天然连续、无需分层惩罚。

---

## 4. 子系统设计

### 4.1 二维位置与泳池边界
当前 `Swimmer` 把 1D 的 `distance` 映射到世界 X（`applyCoursePosition`）。现在要扩成 2D：

- **前进**：`forwardSpeed` 累积成 `distance` → 世界 X（沿用现有 `raceDistanceToCourseX` 链路，含 50m 转身折返）。
- **横向**：`lateralSpeed` 积分成横向偏移 `lateralZ` → 叠加到出生泳道中心的 Z 上。
- **泳池边界钳制**：最终 Z 钳制在泳池内壁范围内（`poolWidth/2 - poolWallClearance`，相对本道中心的偏移上下限由 `Swimmer.configureSteering` 算好传给 motor）。撞到池壁 = 偏移被钳住不再增长（**贴墙滑行**），不反弹、不失速、不须正朝向。
- **泳道绳无碰撞**：可自由穿越（现状本就无碰撞，保持即可）。

### 4.2 身体转向姿态（复用现有，极轻量）
表现的核心只有一条：**整个人体模型绕竖直轴 yaw 到 `heading` 方向**（它就是朝那边游），再叠加一点点**入弯侧倾 bank**（转弯时身体微微向内倾，像转向的鱼）。

- 在 `CartoonSwimmerRig` / `FreestylePoseController` 把模型根节点的 yaw 设为 `heading`，bank = `heading * bankScale`。
- **手臂前伸方向要跟随 heading**（已修）：`FreestylePoseController._movementForwardWorld` 原为固定泳道轴 `(±1,0,0)`，`movementForwardInRoot` 会把根节点世界旋转（含身体 yaw）除掉，导致身体转了手臂还锁着泳道方向。现在 `_movementForwardWorld` = 泳道轴绕 Y 旋转 `heading`（`setMovementHeadingRadians`，由 `updateFreestyleFromMotor` 每帧喂 `motor.heading`），手臂便沿实际游动方向前伸。
- 现有自由泳划水姿态**照常播放**，不需要新动作。喜感来自"斜着的身体 + 蛇形轨迹 + 从背后看的冲刺视角"。
- 平滑：yaw/bank 对 `heading` 做低通，避免抖动。性能瓶颈是程序化姿态（见 repo memory），这里只多两个旋转量，开销可忽略；AI 仍走姿态节流。

### 4.3 冲刺视角（游泳阶段主视角）
- 玩家出水后主相机自动切到 `RaceCameraMode.Sprint`（`GameFlowController` 里一次性 `selectMode`，之后玩家可手动循环切回）。由 `STEERING_TUNING.useSprintSwimView` 开关。
- **逐轴缓动（已实现）**：相机前进/高度（X/Y）用 `sprintFollowSpeed` 紧跟；**横向（Z）用 `sprintLateralFollowSpeed` 故意慢跟** —— 选手蛇形时先在画面里滑出去、相机再缓缓横移追上，玩家才感受得到偏移。相机 Z 摆得越慢偏移越明显。
- 跳水/水下/转身/赛前/颁奖等分支不动，只改"游泳推进段"的主视角选择。

### 4.4 AI 转向性格化（已实现基础版）

AI 与玩家**共用同一套划水转向逻辑**：`applyStrokeSteering` 对所有人生效，AI 不做任何单独的转向系统，只**控制输入**（决定划哪一侧），蛇形完全从"不完美的输入"里涌现。

- 每次划水结算后，AI 在 `AISwimmerController.pickNextSide` 里选下一侧：
  - **偏离过大**（`|steeringHeadingRatio| ≥ aiCorrectHeadingRatio`）→ 有 `difficulty` 概率划**纠偏侧**（`Swimmer.correctiveStrokeSide()`，lap 感知），否则继续跑偏；
  - **接近直行** → 多数整齐交替；但有 `(1-difficulty)×aiWanderChance` 概率**重复同一侧**开始新的跑偏。
- 结果：强对手（difficulty→1）几乎每次都纠偏 + 整齐交替 → 笔直；弱对手（difficulty≤0.5）常乱划、纠偏不足 → 明显蛇形。**天然按难度分级，无需单独的摆动幅度参数**。轨迹有界（越偏越常纠偏 + 池壁钳制）。
- 实现：`Swimmer` 暴露 `steeringHeadingRatio` / `correctiveStrokeSide()`（转发 motor）；`SwimmerMotor` 提供二者；`AISwimmerController.pickNextSide` 决策；`configureSteering` 对所有人 `setSteeringEnabled(true)`。
- **待做（P2+）**：更细的选手个性（如特定"活宝"角色更爱乱划），可接 `CompetitorConfig` 单独字段。

---

## 5. 竞技平衡（风险回报曲线）

保证"中等·风险回报"定位成立：

1. **高手无损**：完美左右交替（或稳定双划）→ 朝向恒在 ±10°，`cos≈1`，完整竞技上限（`maxSpeed 4`）保留。转向系统对高手近乎隐形。
2. **代价连续可见**：朝向越歪、`cos(heading)` 越小、前进越慢，且必须多游一段弧线路程——代价天然、平滑、无劝退的硬惩罚。
3. **双手同划 = 直行（无额外推进）**：双划的左右转向相互抵消，自然保持直行，但不给额外速度（`bothStraightBonus` 未实现）—— 直线快主要靠精准交替，而非一路双划，避免架空蛇形。
4. **穿泳道不影响名次**：进度只按泳道前进（X）算，蛇形只是浪费时间与路程，不因串道产生不公平判定。

**结算彩蛋（P3）**：记录本局"总横向里程 / 最歪瞬间 / 撞墙次数"，终点做一个"今日最会蛇形"评选或滑稽回放，作为社交传播点。

---

## 6. 模块改动点映射（已实现）

| 模块 / 文件 | 改动 |
|---|---|
| `core/SteeringTuning.ts`（新） | `STEERING_TUNING`：turnPerStroke / maxHeading / turnEaseRate / turnPowerMinFactor / bankScale / poolWallClearance / aiCorrectHeadingRatio / aiWanderChance / useSprintSwimView |
| `swimmer/SwimmerMotor.ts` | `_heading`/`_headingTarget`/`_lateralOffset`/`_courseDirection`；`update()` 拆 forward=cos/lateral=sin 并积分钳制；`updateSteering()` ease 追目标（无自动回正）；`applyStrokeSteering(type, power)` 在划水结算时调（side×lap×力度，玩家+AI 共用）；`beginFlipTurnPhase` 归正对墙；getter `heading`/`lateralOffset`/`steeringHeadingRatio`；`correctiveStrokeSide()`；setter `setSteeringEnabled`/`setLateralOffsetBounds`/`setCourseDirection` |
| `entity/Swimmer.ts` | `configureSteering`（**所有人**启用+泳池偏移上下限）；`steeringHeadingRatio`/`correctiveStrokeSide()` 转发 motor；`applyCoursePosition` 前进→X + 横向→Z + yaw 面朝行进 + 入弯侧倾 + `setCourseDirection` |
| `entity/AISwimmerController.ts` | `pickNextSide` 按 difficulty 决定下一划水侧（偏离则纠偏、接近直行则可能乱划），AI 只控制输入、走玩家同一转向路径 |
| `entity/SwimmerRacePhases.ts` | 翻滚转身定位带上 `motor.lateralOffset`（防 Z 跳变） |
| `character/FreestylePoseController.ts` | `_movementForwardWorld` 随 `heading` 旋转（`setMovementHeadingRadians`/`updateMovementForwardWorld`），手臂沿实际游动方向前伸 |
| `entity/CartoonSwimmerRig.ts` | `updateFreestyleFromMotor`/`updateUnderwaterKickFromMotor` 每帧喂 `motor.heading` 给 pose |
| `camera/RaceCameraDirector.ts` | `updateSprintCamera` 改 dt-based 逐轴平滑（sprintFollowSpeed 前向 / sprintLateralFollowSpeed 横向慢跟） |
| `app/GameFlowController.ts` | 玩家出水后一次性 `selectMode(Sprint)`（`useSprintSwimView` 开关） |
| `competitor/CompetitorManager.ts` | 给每道分配 `difficulty`（AI 转向强弱由控制器按 difficulty 决策，无单独调用） |
| `core/TuningDebugControls.ts` | “转向”组（9 滑块）+ “冲刺与终点相机”组新增 2 滑块 |

> **无新增采样动作 / 音效资源**。

---

## 7. tuning 参数清单（实际面板）

“转向”组（`SteeringTuning.ts`，随 tuning.json 持久化）：

```
steer.turnPerStroke              默认 14     单手划水施加的转向角（度）
steer.maxHeading                 默认 65     朝向角上限（度）
steer.turnEaseRate               默认 3.5    实际朝向追目标的平滑速率（/s）
steer.turnPowerMinFactor         默认 0.35   最短划水的转向倍率（拉满=1.0）
steer.bankScale                  默认 0.25   入弯侧倾幅度
steer.poolWallClearance          默认 0.4    撞墙余量（米）
steer.aiCorrectHeadingRatio      默认 0.3    AI 偏离多少（占 maxHeading）后开始纠偏
steer.aiWanderChance             默认 0.5    AI 直行时打破交替开始蛇形的基础概率（按 1-难度 缩放）
```

“冲刺与终点相机”组新增：

```
camera.sprintFollowSpeed         默认 14     冲刺相机前向/高度跟随速度（/s）
camera.sprintLateralFollowSpeed  默认 3.2    冲刺相机横向跟随速度（越低偏移越明显）
```

> `useSprintSwimView`（布尔）不是滑块，在 `SteeringTuning.ts` 里改。所有滑块值能被 tuning.json 覆盖（沿用 `GameManager.onLoad` 加载链路）。

---

## 8. 落地节奏

- **已完成**：朝向角转向模型（§2，含发力缩放、无自动回正、方向随 lap 翻转）+ 2D 位置与池壁钳制（§4.1）+ 身体/手臂随 heading 转向（§4.2）+ 冲刺视角与横向缓动（§4.3）+ AI 按难度蛇形（§4.4）+ tuning 面板。
- **待做**：`bothStraightBonus`（双划直行强推，若需要）；撞墙反馈打磨（现在只钳制贴滑）；AI 选手个性细分；入弯侧倾观感微调；结算"最会蛇形/撞墙次数"评选或滑稽回放（P3，§5）。

---

## 9. 决策记录与仍待定

**已决策（按实机反馈定下）**：

1. 转向在划水**结算/松手**时触发、身体**逐渐**转过去（`turnEaseRate`），不在按下瞬间。
2. **无自动回正**：纯手动，想直行必须主动左右交替。
3. 转向量**与发力（拉水行程）挂钩**：轻点微拐、重划狠拐。
4. 方向：右手→屏幕左、左手→屏幕右，且**随 lap 翻转**，折返后一致。
5. 50m 翻滚蹬墙那一刻**强制 heading 归正对墙**。
6. 撞池壁**只贴墙滑行**，不反弹不失速。
7. 进度只按前进分量（`cos` 折算），蛇形纯属浪费路程与时间。
8. AI 也蛇形，幅度**按每道 difficulty 反向缩放**（强对手更直）。

**仍待定**：

1. 手感数值（`turnPerStroke` 14° / `maxHeading` 65° / `turnEaseRate` 3.5 / `turnPowerMinFactor` 0.35）是否合适 —— 实机滑块微调。
2. 冲刺相机横向慢跟幅度（`sprintLateralFollowSpeed` 3.2）是否让偏移感恰当。
3. 是否需要 `bothStraightBonus`（双划直行强推）作为策略选项。
4. 是否叠加“比赛难度档位”对 AI 蛇形再压一层（目前仅按每道 difficulty）。
5. 撞墙是否要加轻微反弹/滑稽反馈。
