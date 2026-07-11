# Swimming 运行时接口草案

## 1. 目标

这份文档只回答实现层问题：

- `RaceContext` 谁创建、谁持有、谁更新
- `PlayerConditionModel` 最小接口如何定义
- `DiveResult` 如何进入当前主循环
- 第一版如何在不打碎现有代码的前提下接入新状态层

这不是最终代码，而是第一版实现草案。

## 2. 总体结构

建议把运行时结构分成四层：

1. 比赛全局层  
   `RaceManager`

2. 流程编排层  
   `GameFlowController`

3. 比赛状态层  
   `RaceContext`  
   `PlayerConditionModel`  
   `DiveResult`

4. 动作与实体层  
   `SwimmerMotor`  
   `Swimmer`

一句话：

- `RaceManager` 管比赛
- `GameFlowController` 管流程
- `RaceContext` 管上下文
- `PlayerConditionModel` 管状态
- `SwimmerMotor` 管动作

## 3. `RaceContext` 的职责

`RaceContext` 的职责建议非常克制：

- 持有本局比赛共享状态
- 不直接做动作计算
- 不直接做表现
- 不直接负责 UI

第一版建议它只负责聚合下面这些对象和状态：

- 当前比赛主阶段
- `PlayerConditionModel`
- 当前 `DiveResult | null`
- 当前是否进入终盘
- 当前是否允许冲刺强度升级

## 4. `RaceContext` 谁创建

第一版建议：

- **由 `GameManager` 创建**

原因：

- `GameManager` 本来就是当前运行时组合根
- 它负责拼装 `RaceManager`、`GameFlowController`、`Swimmer`、UI 等对象
- 在不大改现有结构的前提下，由它创建 `RaceContext` 最自然

结论：

- `GameManager` 创建 `RaceContext`
- 再把它通过构造参数传给 `GameFlowController`

## 5. `RaceContext` 谁持有

第一版建议：

- **主持有者是 `GameManager`**
- **主使用者是 `GameFlowController`**

也就是说：

- `GameManager` 生命周期上拥有它
- `GameFlowController` 流程上驱动它

这样分的好处是：

- 生命周期清楚
- 不会让 `RaceContext` 变成某个动作类的私有状态

## 6. `RaceContext` 谁更新

建议分工如下：

### 6.1 `GameFlowController`

负责更新：

- 比赛主阶段
- 跳水结果写入
- 终盘阶段进入
- 冲刺强度层级变化

### 6.2 `PlayerConditionModel`

负责更新：

- 心率
- 心率区间
- 体能
- 空体状态
- 质量修正
- 效率修正

### 6.3 `RaceManager`

不直接更新 `RaceContext` 的细规则字段，只负责提供：

- 当前比赛阶段变化信号
- 计时
- 是否进入最后距离区间

结论：

- `RaceManager` 提供比赛时机
- `GameFlowController` 决定何时驱动上下文
- `PlayerConditionModel` 负责状态本体更新

## 7. `RaceContext` 的最小结构建议

第一版建议可以先是这样的形状：

```ts
export type RacePhase = 'START' | 'PACE' | 'SPRINT' | 'RESULT';

export interface RaceContext {
  phase: RacePhase;
  playerCondition: PlayerConditionModel;
  latestDiveResult: DiveResult | null;
  sprintActive: boolean;
}
```

说明：

- 不建议第一版往里塞太多派生状态
- 让它先作为“共享比赛状态容器”存在

## 8. `PlayerConditionModel` 的职责

`PlayerConditionModel` 是新规则层的核心。

它负责：

- 更新心率
- 更新体能
- 更新当前心率区间
- 更新空体状态
- 输出动作质量修正
- 输出推进效率修正
- 输出当前冲刺强度层级

它不负责：

- 直接处理玩家输入事件
- 直接操作场景节点
- 直接做表现触发

一句话：

- 它是“状态与资源计算器”

## 9. `PlayerConditionModel` 的最小字段建议

第一版最小字段集：

```ts
export type HeartRateZone =
  | 'LOW'
  | 'OPTIMAL'
  | 'HIGH_PRESSURE'
  | 'OVERLOAD';

export type SprintTier =
  | 'STEADY'
  | 'PUSH'
  | 'GAMBLE';

export interface PlayerConditionState {
  phase: RacePhase;
  heartRate: number;
  heartRateZone: HeartRateZone;
  energy: number;
  energyDepleted: boolean;
  sprintTier: SprintTier;
  qualityModifier: number;
  efficiencyModifier: number;
}
```

## 10. `PlayerConditionModel` 的最小接口建议

第一版建议不要做太大，先有下面这些接口就够。

### 10.1 初始化接口

```ts
export interface PlayerConditionModel {
  reset(): void;
  setPhase(phase: RacePhase): void;
  applyDiveResult(result: DiveResult): void;
}
```

说明：

- `reset()`：开新比赛时恢复默认状态
- `setPhase(...)`：切阶段时切换心率 / 体能更新解释
- `applyDiveResult(...)`：把跳水结果映射到开局状态

### 10.2 更新接口

```ts
export interface StrokeConditionInput {
  rawQuality: number;
  strokeAccepted: boolean;
  strokeHeldRatio?: number;
  dt: number;
}

export interface SprintConditionInput {
  sprintTier: SprintTier;
  dt: number;
}

export interface PlayerConditionModel {
  // ...
  updateFromStroke(input: StrokeConditionInput): void;
  updateSprintState(input: SprintConditionInput): void;
  tick(dt: number): void;
}
```

说明：

- `updateFromStroke(...)`：每次动作后更新心率和体能
- `updateSprintState(...)`：终盘强度管理
- `tick(dt)`：处理持续性的回落、持续燃烧和阶段性衰减

### 10.3 查询接口

```ts
export interface PlayerConditionModel {
  // ...
  getState(): Readonly<PlayerConditionState>;
  isOptimal(): boolean;
  isOverloaded(): boolean;
  canHighQualitySprint(): boolean;
}
```

说明：

- 外层逻辑尽量不要自己散着判断区间
- 让状态模型统一回答这些问题

## 11. `DiveResult` 的最小接口建议

第一版建议先以纯数据对象处理，不急着做成类。

```ts
export type DiveQualityTier = 'GOOD' | 'NORMAL' | 'BAD';
export type DiveEntryStyle = 'CLEAN' | 'NORMAL' | 'MESSY';

export interface DiveResult {
  qualityTier: DiveQualityTier;
  entryStyle: DiveEntryStyle;
  entryDistance: number;
  entrySpeed: number;
  heartRateStartModifier: number;
  heartRateStartupWobbleModifier: number;
  optimalZoneEntryModifier: number;
}
```

## 12. 当前主循环里的接入位置

第一版建议这样接。

### 12.1 比赛开始时

由 `GameManager`：

- 创建 `RaceContext`
- 创建 `PlayerConditionModel`
- 注入 `GameFlowController`

### 12.2 进入跳水结算时

由 `GameFlowController`：

- 产出 `DiveResult`
- 写入 `RaceContext.latestDiveResult`
- 调用 `playerCondition.applyDiveResult(result)`

### 12.3 进入中段时

由 `GameFlowController`：

- 切 `RaceContext.phase = 'PACE'`
- 调用 `playerCondition.setPhase('PACE')`

### 12.4 每次动作结算后

由 `GameFlowController` 或 `Swimmer` 上层协调逻辑：

- 从 `SwimmerMotor` 读取原始动作结果
- 调用 `playerCondition.updateFromStroke(...)`
- 再读取修正后的 `qualityModifier` / `efficiencyModifier`

### 12.5 终盘开始时

由 `GameFlowController`：

- 切 `RaceContext.phase = 'SPRINT'`
- 设置 `sprintActive = true`
- 驱动 `playerCondition.updateSprintState(...)`


## 12.6 动手前必须先确认的三件事

上面是把新状态层接进现有主循环的落点。但在真正动刀之前，有三个和现有代码强相关的坑必须先定下来，否则第一刀下去就会撞到。

#### 12.6.1 RhythmEvaluator 的去留

项目里现在存在两套并行的节奏判定：

- `SwimmerMotor` 里基于 `holdRatio` 的稳定性判定，产出 `strokeQuality` 再映射成 `Rating`
- `RhythmEvaluator` 是一个独立的 `Component`，自己维护 `combo`、`speedMultiplier`、`perfectWindow / goodWindow`，也产出 `RhythmResult`

也就是说，`PERFECT / GOOD / BAD` 这条链不止来自 `SwimmerMotor`。文档里一直说“用心率替代 PERFECT / GOOD / BAD 作为主反馈”，但落地时必须先回答：`RhythmEvaluator` 这一层是删、是降级、还是只保留给 `ModelDebug`。否则会出现两套 combo 逻辑同时跑、互相打架。

结论：

- 第一版动手前，必须先明确 `RhythmEvaluator` 的归属
- 它不能和新心率系统同时作为主反馈源存在

#### 12.6.2 DiveResult 改造必须连带处理状态调度

计划里已经注意到 AI 跳水绕过了 `RaceManager.startFromDive`，建议用统一解析器产 `DiveResult` 再分发，方向正确。

但有一个连带副作用没提到：

- `RaceManager.startFromDive` 现在不只是传 `power`，它还承担“按 `Swimmer.performDive` 返回的动画时长调度切 `RACING`”这个职责
- AI 那条链直接 `performDive(power)`，完全不经 `RaceManager`，也不触发 `onDiveReady`

结论：

- 把 `performDive(power)` 改成 `performDive(result)` 时，必须同时定义“谁来等动画时长、谁来切状态”
- 不能只改入参类型，否则状态转移会断在 `DIVING`

#### 12.6.3 GLIDING 不是现成可用，是预留但未接通

计划里提到 `GLIDING` 可以复用为“跳水入水后到稳定节奏前”的起步阶段。结构上成立，但它现在基本是死代码：

- `RaceManager` 里有 `updateGliding` 分支，但 `startFromDive` 直接从 `DIVING` 调度到 `RACING`，从不进入 `GLIDING`
- `GameFlowController` 里对 `GLIDING` 只有一行相机和 UI 处理

结论：

- 它不是“填内容就能用”，而是“需要自己接通 `DIVING -> GLIDING -> RACING` 的转移”
- 如果第一版要复用它做起步阶段，要把状态转移接通作为前置任务，不能假设它已经能用

## 13. 第一版不建议怎么做

第一版不建议：

- 让 `SwimmerMotor` 直接持有 `PlayerConditionModel`
- 让 `Swimmer` 自己更新心率和体能
- 让 `RaceManager` 直接写心率区间和体能数值
- 一开始就让 `RaceContext` 包含太多表现字段

因为这些做法都会重新把状态层和动作层混回去。

## 14. 第一版最小实现路径

建议顺序：

1. 先新增纯数据结构  
   `DiveResult`  
   `PlayerConditionState`

2. 再新增状态类  
   `PlayerConditionModel`

3. 再新增上下文  
   `RaceContext`

4. 最后修改 `GameFlowController` 接入调用顺序

这样能保证：

- 每一步都能单独验证
- 改动不会一次性打穿整个工程

## 15. 当前阶段最值得继续细化的三个问题

1. `RaceContext` 具体是挂在 `GameManager` 私有字段上，还是额外做 provider 风格传递
2. `PlayerConditionModel.updateFromStroke(...)` 需要哪些最小输入，才能不反向污染 `SwimmerMotor`
3. 第一版终盘的 `sprintTier` 切换逻辑到底由谁决定

## 16. `updateFromStroke(...)` 的输入语义

这一节只讨论接口设计，不讨论最终代码实现细节。

问题是：

- `PlayerConditionModel.updateFromStroke(...)` 到底该吃什么
- 才能既让状态层足够有信息更新心率和体能
- 又不把动作层重新污染回状态模型

这一节的核心结论是：

- **它不应直接吃原始输入事件**
- **它应吃动作层已经判定过的结果摘要**

一句话：

- `SwimmerMotor` 解释输入
- `PlayerConditionModel` 消费动作结果

## 16.1 不建议直接传什么

我不建议 `updateFromStroke(...)` 直接吃下面这些原始信息：

- `StrokeType.LEFT / RIGHT / BOTH`
- 原始按下时间戳
- 原始松开时间戳
- 原始按住时长明细
- 原始输入 freshness / lead 的明细结构
- `SwimmerMotor` 内部 action 队列状态

原因：

- 这些都属于动作解释层
- 如果状态模型也依赖这些细节，就说明动作层和状态层没有真正拆开

## 16.2 我建议输入分成四组语义

第一版最小输入建议按四组语义来理解：

- 动作结果组
- 动作强度组
- 时间组
- 阶段上下文组

其中“阶段上下文组”不一定要每次都传，因为 `PlayerConditionModel` 自己已经持有 `phase`。

## 16.3 第一组：动作结果组

这一组的作用是：

- 告诉状态模型“这一下动作到底打得怎么样”

最少需要承载的信息：

- 这一下动作是否被接受
- 这一下原始动作质量大概如何

这里最关键的一点是：

- 传给状态模型的应该是“解释后的动作结果”
- 不是“等待状态模型自己再去判断输入对不对”

## 16.4 第二组：动作强度组

这一组的作用是：

- 告诉状态模型“这一下压得有多猛”

为什么它必须存在：

- 心率不只看动作对不对
- 还看玩家当前输出强度高不高
- 终盘高压和过载的成立，也需要这一层输入

如果没有这组，状态模型就很难区分：

- 玩家只是稳定地游
- 还是已经进入了主动加压状态

## 16.5 第三组：时间组

这一组的作用是：

- 支撑连续状态更新

因为 `PlayerConditionModel` 不是只对单拍做反应，它还要管理：

- 心率持续上升
- 心率回落
- 体能连续燃烧
- 空体后的持续衰减

所以至少需要知道：

- 距离上一次状态更新过去了多久

第一版最简单的方式就是：

- 传 `dt`

## 16.6 第四组：阶段上下文组

这一组不是每次都要作为参数传，但概念上必须存在。

原因是：

- 同样一次动作，在 `START / PACE / SPRINT` 阶段解释不同

我建议第一版不要把它塞进 `updateFromStroke(...)` 参数里，而是：

- 让 `PlayerConditionModel` 自己持有 `phase`
- 更新前由外层先切好阶段

这样接口会更干净。

## 16.7 动作质量应该用分档、连续值，还是混合结构

这是一个很关键的接口设计点。

我的建议是：

- **第一版优先用连续值**
- **必要时再附带一个轻量布尔或枚举**

原因：

- 当前 `SwimmerMotor` 本身已经有连续质量概念，例如稳定性和相关质量判断
- 如果过早把它硬压成纯枚举，会丢掉很多可用信息

所以我更推荐：

- 动作质量主字段用 `0..1` 这样的归一化连续值
- 再补一个极轻量状态字段，用来区分“这一下是否成立”

## 16.8 动作强度应该用分档、连续值，还是混合结构

我的建议和动作质量一样：

- **第一版优先用连续值**

原因：

- 终盘强度管理本身就是连续过程
- 如果一开始就压成离散档位，容易做得太硬

更合适的做法是：

- 先用一个 `0..1` 的强度摘要值
- 后续需要表现层或调参层更粗的时候，再从它推导档位

也就是说：

- 状态模型吃连续值
- 外层或表现层可以把它读成“稳 / 压 / 赌”

## 16.9 第一版推荐的最小输入形状

如果只从接口语义看，我建议第一版 `updateFromStroke(...)` 最少需要这四个字段：

- `strokeAccepted`
- `qualityScore`
- `pressureScore`
- `dt`

这四个字段已经足够支撑第一版状态更新。

## 16.10 每个字段的含义

### `strokeAccepted`

含义：

- 这一下动作是否真正被动作层接受为有效动作

为什么需要：

- 因为并不是所有输入都应被记为有效状态推进
- 例如重复、排队失败、无效输入，不应和有效动作同权处理

### `qualityScore`

含义：

- 动作层给出的原始动作质量摘要

推荐理解：

- `0..1`
- `0` 非常差
- `1` 非常顺

为什么需要：

- 状态模型要知道这一下是把状态往好推，还是往乱推

### `pressureScore`

含义：

- 当前这一下动作的输出强度摘要

推荐理解：

- `0..1`
- 越高表示越激进、越高压

为什么需要：

- 心率增长看的是“有没有压”
- 不只是“有没有打对”

### `dt`

含义：

- 距离上一次状态更新过去了多久

为什么需要：

- 心率回落、体能燃烧、持续高压都离不开时间维度

## 16.11 为什么我不建议第一版直接传枚举档位

如果直接只传：

- `GOOD / NORMAL / BAD`
- `STEADY / PUSH / GAMBLE`

虽然看起来简单，但会有两个问题：

- 状态模型会太硬，后续调手感不够细
- 当前动作层已经有更细的质量信息，过早丢掉不划算

所以第一版更推荐：

- 状态模型吃连续摘要值
- 档位更多用于表现层、调试层或日志层

## 16.12 一个重要边界

我建议先把这条边界当成接口设计红线：

- `SwimmerMotor` 输出动作结果
- `PlayerConditionModel` 消费动作结果摘要
- `PlayerConditionModel` 不重新解释原始输入过程

只要守住这条边界，状态层和动作层就不会重新粘死。

## 16.13 一个更稳的接口方向

如果继续保持克制，第一版甚至可以先只让 `updateFromStroke(...)` 做一件事：

- 读取本拍动作结果，推进状态机

也就是说：

- 它不负责复杂业务分发
- 它只是让心率和体能顺着动作结果往前演化

这会让模型更纯。

## 16.14 当前阶段可以先定下来的共识

截至目前，这一块建议先形成如下共识：

- `updateFromStroke(...)` 不应吃原始输入事件
- 它应吃动作层已经解释好的结果摘要
- 第一版最小输入建议包含：
  - `strokeAccepted`
  - `qualityScore`
  - `pressureScore`
  - `dt`
- 动作质量和动作强度都更适合先用连续值，而不是纯枚举
- 阶段信息由模型内部持有，不建议每次重复传参

## 16.15 下一步建议

如果继续往下推，下一步最值得讨论的是：

- `pressureScore` 到底由谁计算
- `sprintTier` 第一版由谁决定、何时切换
- `RaceContext` 是简单字段容器，还是需要少量辅助方法

## 17. `pressureScore` 的归属

这一节专门回答：

- `pressureScore` 到底应该由谁计算

这个问题非常关键，因为它决定：

- 动作层和状态层的边界是否清楚
- 终盘强度管理会不会重新散回流程层
- 后续代码会不会继续把同一类逻辑写到多个地方

## 17.1 先说结论

我的建议是：

- **第一版由 `SwimmerMotor` 产出 `pressureScore` 摘要**
- **`PlayerConditionModel` 只消费它，不自己回推**
- **`GameFlowController` 不负责逐拍计算 `pressureScore`**

换句话说：

- `pressureScore` 属于动作层输出的一部分
- 不是流程层状态，也不是状态层反推结果

## 17.2 为什么不建议由 `GameFlowController` 计算

表面上看，`GameFlowController` 管流程，似乎也可以知道：

- 当前是不是终盘
- 玩家是不是在冲

但它不适合算 `pressureScore`，原因有三个。

### 1. 它离局部动作太远

`pressureScore` 不是纯阶段概念，它还依赖：

- 这一拍动作本身打得猛不猛
- 当前节奏是否连续高压
- 当前是否属于激进输出

这些都更接近动作层信息。

### 2. 它容易重新变成上帝类

如果让 `GameFlowController` 开始逐拍判断：

- 这一下压得够不够猛
- 这一下是不是高压输出

那它就会重新吃进大量本应属于动作解释层的信息。

### 3. 它不利于后续复用

以后如果：

- AI 也要走同样的状态系统
- 调试模式也要走同样规则

那把 `pressureScore` 逻辑绑在流程层会很别扭。

## 17.3 为什么不建议由 `PlayerConditionModel` 自己反推

看起来也可以让状态模型根据：

- 心率
- 体能
- 当前区间

反推出“这一拍压得猛不猛”。

但我不建议这么做。

原因是：

- `pressureScore` 描述的是“这次动作的输出强度”
- 不是“现在整体状态有多危险”

如果由 `PlayerConditionModel` 自己反推，它会出现职责混淆：

- 状态模型开始反过来解释动作层

这违反了我们前面已经定下来的边界：

- `SwimmerMotor` 输出动作结果
- `PlayerConditionModel` 消费动作结果摘要

## 17.4 为什么更适合由 `SwimmerMotor` 产出

`SwimmerMotor` 是当前最适合产出 `pressureScore` 的地方，原因是：

### 1. 它最接近局部动作事实

它已经掌握：

- 当前动作是否成立
- 当前动作的节奏质量
- 当前动作是否处于连续高压输出
- 当前动作推进脉冲有多强

这些都是判断“这一拍压得猛不猛”的基础材料。

### 2. 它本来就在做局部动作解释

`pressureScore` 本质上也是局部动作解释的一部分。

只是它不再回答：

- 这一下准不准

而是回答：

- 这一下压得狠不狠

这仍然属于动作层语义。

### 3. 它产出摘要后，状态层就能保持干净

只要 `SwimmerMotor` 输出的是摘要，而不是把内部复杂结构暴露出去，状态层就仍然可以保持：

- 轻依赖
- 清晰边界

## 17.5 这里有一个重要边界

虽然我建议由 `SwimmerMotor` 产出 `pressureScore`，但这不意味着：

- 要把终盘规则本身塞进 `SwimmerMotor`

这一点必须分清。

正确做法是：

- `SwimmerMotor` 只负责产出“局部动作强度摘要”
- 至于这个摘要在 `START / PACE / SPRINT` 阶段如何解释，由 `PlayerConditionModel` 决定

也就是说：

- 动作层产出原始强度
- 状态层按阶段解释强度

这条边界很关键。

## 17.6 `pressureScore` 到底代表什么

为了防止后续理解跑偏，我建议先把 `pressureScore` 的语义定清楚：

- 它代表“当前这一下动作 / 这一小段动作的原始输出强度摘要”

它不直接等于：

- 心率值
- 冲刺档位
- 最终推进收益

它更像一个中间量，用来回答：

- 这一拍是保守、正常，还是激进

## 17.7 `pressureScore` 应该参考哪些底层因素

第一版不需要全写死，但我建议它主要由下面几类东西综合出来：

### 1. 当前动作频率感

不是简单的每秒点击数，而是：

- 当前这一拍是否处在较高密度输出节奏中

### 2. 当前动作兑现强度

例如：

- 当前推进脉冲是不是明显偏强

### 3. 当前动作是否属于主动加压

例如：

- 虽然动作没错，但当前输出正在明显往高压方向推

注意：

- 这些是动作层内部综合因素
- 不要求全部暴露给状态层

状态层只需要最终摘要值。

## 17.8 第一版不建议怎么做

第一版不建议：

- 直接用当前速度来代替 `pressureScore`
- 直接用心率区间反推 `pressureScore`
- 在 `GameFlowController` 里手写一套终盘强度推断

这些做法的问题是：

- 会把因果方向搞反
- 会让动作层和状态层重新打结

## 17.9 第一版推荐的接口方向

如果按第一版最稳的方式落地，我建议：

- `SwimmerMotor` 在动作结算后提供一个原始 `pressureScore`
- `PlayerConditionModel.updateFromStroke(...)` 读取这个值
- `PlayerConditionModel` 再结合 `phase`、`heartRateZone`、`energy` 去解释它会造成多大状态变化

链路应当是：

- 原始动作强度
- 状态层解释
- 心率 / 体能变化

而不是：

- 状态层先决定你是不是高压
- 再回推这一下算不算高压动作

## 17.10 当前阶段可以先定下来的共识

截至目前，这一块建议先形成如下共识：

- `pressureScore` 更适合由 `SwimmerMotor` 产出
- `GameFlowController` 不负责逐拍计算 `pressureScore`
- `PlayerConditionModel` 不负责反向解释动作层强度
- `pressureScore` 是动作层摘要，不是状态层结果
- 阶段差异由状态层解释，不由动作层硬编码

## 17.11 下一步建议

如果继续往下推，下一步最值得讨论的是：

- `sprintTier` 第一版由谁决定、何时切换
- `pressureScore` 第一版到底做成单拍值，还是短窗平滑值
- `RaceContext` 是否需要提供少量辅助方法

## 18. `pressureScore`：单拍值 vs 短窗平滑值

这一节继续讨论 `pressureScore` 的具体形态：

- 它第一版到底应该表示“这一拍有多猛”
- 还是表示“最近一小段时间整体有多猛”

这个选择会直接影响：

- 心率变化是更抖还是更顺
- 终盘强度感是更碎还是更连续
- 玩家是否容易理解自己正在进入高压状态

## 18.1 两种做法的定义

### 方案 A：单拍值

含义：

- 每次动作结算时，直接给出这一拍的原始强度

也就是说：

- 这一拍猛，就高
- 这一拍普通，就中
- 这一拍保守，就低

特点：

- 颗粒度强
- 响应很快
- 很有“这一拍打得猛不猛”的直接感

### 方案 B：短窗平滑值

含义：

- `pressureScore` 表示最近一小段时间的综合强度
- 不是只看这一拍，而是看最近几拍是否持续在压

特点：

- 连续感更强
- 更像“当前整体输出状态”
- 不容易因为单拍波动而剧烈跳动

## 18.2 单拍值的优点

### 1. 因果感最直接

玩家最容易建立感觉：

- 我刚刚这一下更猛，所以强度上去了

### 2. 很适合做局部反馈

如果你后面想做：

- 一拍猛冲
- 一拍虚掉

单拍值会很适合驱动局部表现。

### 3. 动作层语义更纯

因为它确实是在描述：

- 这一拍动作的原始强度

所以从动作层语义上说，它非常干净。

## 18.3 单拍值的缺点

### 1. 太容易抖

如果状态层直接吃单拍值，心率和体能的变化很容易显得：

- 太碎
- 太抖
- 太敏感

### 2. 不够像“持续压强度”

你现在的终盘设计强调的是：

- 持续加压
- 持续榨体能
- 持续把自己推向高压和过载

如果只看单拍，系统容易过度关注每一下，而削弱“这一整段都在冲”的感觉。

### 3. 容易放大偶发噪声

比如：

- 某一拍偶然特别高

不一定代表玩家已经进入终盘高压状态，但单拍值容易把它看得太重。

## 18.4 短窗平滑值的优点

### 1. 更符合终盘的连续压强度设计

终盘不是单拍大招，而是：

- 一段时间内持续推高输出

短窗平滑值更适合表达这种状态。

### 2. 心率更新会更顺

因为状态模型吃到的是：

- 最近一小段时间的综合压力

这会让：

- 心率上升
- 心率回落
- 体能燃烧

都显得更连续。

### 3. 更利于“稳冲 / 压冲 / 赌冲”三层语义成立

因为这三种本来就不是单拍概念，而是：

- 一小段时间内的强度风格

### 4. 更利于区分“偶发猛一下”和“真正持续在压”

这点非常重要。

它能避免：

- 玩家只是偶尔打一拍猛的
- 系统却误判成已经开始冲刺

## 18.5 短窗平滑值的缺点

### 1. 单拍因果感会弱一点

玩家不一定每一拍都立刻感知到：

- 我刚刚这一下更猛

因为它会被平滑掉一部分。

### 2. 如果做得过平，会显得迟钝

如果窗太长、平滑太重，会出现：

- 玩家明明已经开始压了
- 系统却很久才认出来

这会削弱爽感。

## 18.6 我的建议：动作层保留单拍，状态层消费短窗平滑值

如果要兼顾这两边，我最推荐的是：

- **动作层内部可以保留单拍原始强度**
- **传给 `PlayerConditionModel` 的 `pressureScore` 用短窗平滑值**

这是一种中间路线，而且非常适合当前项目。

也就是说：

- `SwimmerMotor` 先知道每一拍猛不猛
- 但对外给状态层的不是裸单拍，而是最近几拍的平滑强度摘要

这样做的好处是：

- 不丢单拍信息
- 状态层又能得到稳定、连续、适合驱动心率的输入

## 18.7 为什么这是第一版最稳的方案

原因有四个。

### 1. 它最贴合“终盘是强度管理阶段”

因为终盘不是比某一拍，而是比：

- 这一小段时间你能把强度顶到什么程度

### 2. 它不容易让心率系统太抖

状态层最怕的是：

- 一拍高、一拍低
- 整个条跳得像噪声

短窗平滑值能明显改善这个问题。

### 3. 它仍然保留了单拍反馈空间

因为单拍值仍可以在动作层内部使用，去驱动：

- 局部反馈
- 水花
- 单拍身体感

### 4. 它与前面已经定下来的接口边界最一致

动作层：

- 保留更细的动作事实

状态层：

- 消费已经摘要化、适合做状态演化的输入

这非常符合我们已经反复确认的分层原则。

## 18.8 第一版窗口应该怎么理解

第一版不必急着定精确拍数，但建议先按这个方向理解：

- 不是整段比赛的长窗
- 也不是完全逐拍
- 而是“最近几拍”的短窗

它应当足够短，保证：

- 玩家一加压，系统很快有反应

也应当足够长，保证：

- 状态变化不会因为单拍波动而太抖

也就是说：

- 目标是“快响应，但不发抖”

## 18.9 这对接口意味着什么

如果采用这套方案，那么 `updateFromStroke(...)` 接口里的：

- `pressureScore`

我建议解释为：

- **动作层对最近一小段时间输出强度的平滑摘要**

而不是：

- 裸的单拍猛度

这点后续要在接口注释里写清楚，避免误用。

## 18.10 当前阶段可以先定下来的共识

截至目前，这一块建议先形成如下共识：

- 单拍值更适合动作层内部
- 状态层更适合吃短窗平滑后的 `pressureScore`
- 第一版不建议让心率系统直接吃裸单拍强度
- `pressureScore` 的语义应是“最近几拍的综合输出强度摘要”
- 目标是让系统快响应，但不发抖

## 18.11 下一步建议

如果继续往下推，下一步最值得讨论的是：

- `sprintTier` 第一版由谁决定、何时切换
- `RaceContext` 是简单字段容器，还是需要少量辅助方法
- `PlayerConditionModel` 的更新顺序如何插入现有 `GameManager.update(...)` / `Swimmer.update(...)` 节点

## 19. `sprintTier` 的归属与切换时机

这一节讨论终盘最关键的控制量之一：

- `sprintTier` 到底由谁决定
- 什么时候切换
- 是显式指令，还是状态模型自然推导出来

这一节很重要，因为它决定：

- 终盘“稳冲 / 压冲 / 赌冲”这三层语义到底落在哪一层
- 终盘逻辑会不会重新散回多个类

## 19.1 先说结论

我的建议是：

- **`sprintTier` 的切换由 `GameFlowController` 驱动**
- **`PlayerConditionModel` 持有并消费这个层级**
- **`SwimmerMotor` 不直接决定 `sprintTier`**

一句话：

- 流程层决定“当前进入哪档冲刺强度”
- 状态层决定“这档强度在当前状态下会造成什么后果”

## 19.2 为什么不建议由 `SwimmerMotor` 决定

虽然动作层掌握了：

- 局部动作质量
- 原始强度摘要

但它不适合直接拍板：

- 当前玩家是不是进入稳冲 / 压冲 / 赌冲

原因是：

### 1. `sprintTier` 不是纯动作事实

它不只是“这一拍猛不猛”，而是：

- 当前终盘策略强度处在哪一层

这个语义已经超过了局部动作层。

### 2. 它和比赛阶段强相关

`sprintTier` 只有在终盘才真正有意义。

而 `SwimmerMotor` 不应该直接承担：

- 比赛阶段策略控制

否则终盘逻辑又会被塞回动作层。

### 3. 它需要结合局面和意图

同样的动作强度，在终盘可能意味着：

- 领先者稳冲
- 落后者压冲
- 最后几米赌博式过载

这已经不是单纯局部动作能定义的东西。

## 19.3 为什么也不建议完全由 `PlayerConditionModel` 自己推导

看起来也可以让状态模型根据：

- 当前心率区间
- 当前体能
- 当前压力摘要

自动推导出当前 `sprintTier`。

但我不建议完全这么做，原因是：

### 1. 这会让“玩家主动选择”变弱

你前面已经定了：

- 终盘不是自动演出
- 玩家要主动决定冲不冲、冲多猛、冲多久

如果 `sprintTier` 完全由状态模型自己推导，它很容易变成：

- 系统替玩家判断你现在属于哪档

这会削弱玩家终盘决策感。

### 2. 状态模型更适合承接结果，不适合承担策略意图

`PlayerConditionModel` 更像：

- 身体状态与资源计算器

而不是：

- 终盘策略意图解释器

## 19.4 为什么更适合由 `GameFlowController` 驱动

`GameFlowController` 是当前最适合驱动 `sprintTier` 的位置，原因是：

### 1. 它本来就负责流程阶段切换

终盘是一个明确比赛阶段。

而 `sprintTier` 本质上是：

- 终盘阶段内部的强度控制语义

这和 `GameFlowController` 的职责天然相邻。

### 2. 它更接近“玩家策略意图”

终盘强度不只是动作事实，更包含：

- 玩家此刻是稳、是压、还是赌

这种“阶段内策略决策”更适合由流程层承接。

### 3. 它可以同时结合：

- 比赛是否进入终盘
- 当前局面是否领先或落后
- 当前玩家输出是否持续加压

这些因素组合起来，驱动强度层级切换会更自然。

## 19.5 那 `GameFlowController` 到底怎么驱动

我不建议做成：

- 手写一个新按钮，直接切 `sprintTier`

也不建议做成：

- 每帧硬编码乱判

第一版更合理的方式是：

- `GameFlowController` 观察终盘阶段下的玩家强度趋势
- 根据趋势和当前局面，给出当前 `sprintTier`

也就是说：

- 它不是完全手动切
- 也不是完全自动推
- 而是流程层根据玩家行为做阶段内强度判断

## 19.6 一个更准确的职责边界

我建议先定这条边界：

- `SwimmerMotor` 负责产出动作强度摘要
- `GameFlowController` 负责把动作强度摘要解释为终盘强度层级
- `PlayerConditionModel` 负责消费强度层级并更新心率、体能和修正值

这三层职责非常清楚：

- 动作层：这一下有多猛
- 流程层：这一段算不算稳冲 / 压冲 / 赌冲
- 状态层：这会带来什么状态后果

## 19.7 第一版切换时机建议

为了让第一版简单、稳定，我建议：

- `sprintTier` 只在 `SPRINT` 阶段有效
- 非 `SPRINT` 阶段默认固定为 `STEADY`

进入终盘后，再根据玩家行为逐渐切换：

- `STEADY`
- `PUSH`
- `GAMBLE`

这样可以避免：

- 中段也开始满地图乱切冲刺层级

## 19.8 第一版切换逻辑建议

第一版不必做得太复杂，可以先按这个方向理解：

### `STEADY`

当玩家：

- 已进入终盘
- 但输出仍较稳
- 没有明显连续加压

### `PUSH`

当玩家：

- 已进入终盘
- 输出强度持续抬高
- 明显在主动压强度

### `GAMBLE`

当玩家：

- 已进入终盘
- 输出强度已经非常高
- 并且愿意承受更大的心率和体能代价

这套逻辑不一定第一版就暴露给玩家一个按钮，而可以先由流程层根据玩家强度趋势做解释。

## 19.9 为什么这仍然算“玩家主动决定”

表面上看，既然不是按钮，那是不是就不够主动？

我的判断是，不是。

因为这里的主动性来自：

- 玩家主动提高或收缩输出强度
- 系统再把这种行为识别成不同冲刺层级

也就是说：

- 玩家不是按按钮选档
- 玩家是通过真实操作把自己推到对应档位

这和你前面定下来的方向是一致的。

## 19.10 第一版不建议怎么做

我不建议第一版做成：

- 完全手动按钮切档
- 完全自动状态模型推档
- `SwimmerMotor` 直接持有 `sprintTier`

这三种都容易在职责边界上出问题。

## 19.11 当前阶段可以先定下来的共识

截至目前，这一块建议先形成如下共识：

- `sprintTier` 由 `GameFlowController` 驱动最合理
- `PlayerConditionModel` 持有并消费 `sprintTier`
- `SwimmerMotor` 不直接决定冲刺档位
- `sprintTier` 只在终盘阶段有效
- 第一版更适合通过玩家强度趋势识别，而不是按钮硬切

## 19.12 下一步建议

如果继续往下推，下一步最值得讨论的是：

- `RaceContext` 是简单字段容器，还是需要少量辅助方法
- `PlayerConditionModel` 的更新顺序如何插入现有主循环
- 第一版终盘中，领先者与落后者对 `sprintTier` 的触发阈值是否完全一致

## 20. `RaceContext` 的边界：字段容器 vs 少量辅助方法

这一节讨论：

- `RaceContext` 到底应不应该有方法
- 如果有，哪些方法是合理的
- 如何避免它变成新的上帝对象

这个问题虽然看起来小，但实际上很关键，因为：

- 一旦 `RaceContext` 边界不清楚
- 后面各种规则、状态、阶段判断都会很容易往里面堆

## 20.1 先说结论

我的建议是：

- **第一版的 `RaceContext` 不应只是裸字段包**
- **但它也不应成为规则逻辑容器**

更准确地说：

- 它应当是“轻上下文对象”
- 可以带少量语义清楚的辅助方法
- 但不负责做具体规则计算

一句话：

- `RaceContext` 可以帮忙组织信息
- 但不应该替代 `GameFlowController` 或 `PlayerConditionModel`

## 20.2 为什么不建议做成完全裸字段容器

如果 `RaceContext` 完全只是：

- 一堆 public 字段

短期看实现快，但很容易带来两个问题：

### 1. 调用方会四处手写判断

比如外层逻辑会开始到处写：

- 当前是不是终盘
- 当前有没有跳水结果
- 当前是否允许冲刺

这些判断一多，就会变成：

- 语义散
- 调用点乱
- 后续维护困难

### 2. 上下文的使用方式会越来越不统一

今天一个类读这个字段，明天另一个类读另一个字段，后面很容易出现：

- 大家都在直接拼上下文字段
- 没有一致的访问语义

这对长期维护很不好。

## 20.3 为什么也不建议让它长出大量规则方法

另一方面，如果 `RaceContext` 里开始出现很多这种方法：

- 计算心率变化
- 计算冲刺收益
- 计算空体惩罚
- 计算终盘阈值

它就会迅速演化成：

- 第二个规则总控器

这会直接和：

- `GameFlowController`
- `PlayerConditionModel`

的职责冲突。

所以要避免：

- 让 `RaceContext` 成为“什么都能算一点”的便利类

## 20.4 我建议的定位

我建议把 `RaceContext` 明确定位成：

- **比赛期共享状态容器**
- **带少量只负责提高语义清晰度的辅助方法**

它最适合做的是：

- 持有状态
- 统一暴露少量高频语义判断

它不适合做的是：

- 规则计算
- 资源更新
- 动作解释

## 20.5 哪些辅助方法是合理的

第一版如果要给 `RaceContext` 方法，我建议只保留下面这类：

### 1. 阶段语义判断

例如：

- `isStartPhase()`
- `isPacePhase()`
- `isSprintPhase()`

这类方法的价值在于：

- 少写重复判断
- 让调用方更清楚自己在问什么

### 2. 状态存在性判断

例如：

- `hasDiveResult()`
- `hasPlayerCondition()`

这类方法也很安全，因为它们不做规则，只做语义包装。

### 3. 少量终盘可读性判断

例如：

- `isSprintActive()`

前提是它只是读取已有字段，不做复杂推导。

## 20.6 哪些辅助方法不建议第一版放进来

我不建议第一版把下面这类方法塞进 `RaceContext`：

- `computeHeartRateDelta()`
- `computeSprintReward()`
- `computeEnergyPenalty()`
- `resolveDiveStartState()`
- `determineSprintTier()`

这些都已经属于：

- 规则逻辑
- 状态更新逻辑
- 流程解释逻辑

它们应该分别待在：

- `PlayerConditionModel`
- `GameFlowController`
- `DiveResult` 产出流程

## 20.7 一个稳妥的理解方式

你可以先把 `RaceContext` 理解成：

- **带少量 getter 风格语义包装的共享状态对象**

而不是：

- service
- rule engine
- 状态总计算器

这个定位很重要。

## 20.8 第一版推荐的样子

如果第一版从接口角度描述，我建议它长得像这样：

- 有字段
- 有极少量语义方法
- 无复杂业务逻辑

也就是说，它可以帮助调用方更清楚地读取：

- 当前在什么阶段
- 当前是否进入终盘
- 是否已经有跳水结果

但不会替调用方算：

- 现在该不该升心率
- 现在该不该掉体能
- 现在该不该进过载

## 20.9 这样做的好处

这种设计有几个非常明显的优点：

### 1. 保持上下文清晰

`RaceContext` 的定位不会漂。

### 2. 不抢其他类职责

- `GameFlowController` 仍然负责流程
- `PlayerConditionModel` 仍然负责状态

### 3. 后续扩展风险小

第一版先做轻，上下文不会很快膨胀成新问题。

### 4. 调用方代码可读性更好

少量语义方法会比到处手写字段判断更稳。

## 20.10 当前阶段可以先定下来的共识

截至目前，这一块建议先形成如下共识：

- `RaceContext` 不是纯裸字段包
- 但也不是规则容器
- 第一版可以带少量语义清晰的辅助方法
- 这些方法只做读取包装，不做规则计算
- 规则更新仍然留给 `GameFlowController` 和 `PlayerConditionModel`

## 20.11 下一步建议

如果继续往下推，下一步最值得讨论的是：

- `PlayerConditionModel` 的更新顺序如何插入现有主循环
- 第一版终盘中，领先者与落后者对 `sprintTier` 的触发阈值是否完全一致
- `pressureScore` 和 `qualityScore` 是否应在同一个结算节点上进入状态模型

## 21. `PlayerConditionModel` 的更新顺序

这一节讨论最关键的运行时问题之一：

- 新的状态模型应该在一帧中的什么时候更新
- 它和 `SwimmerMotor`、`Swimmer`、`GameFlowController`、UI 更新的顺序怎么排

这个顺序如果不先定清楚，后面很容易出现：

- 读到上一帧状态
- 状态和表现错一拍
- 心率、体能和推进结果互相打架

## 21.1 先说结论

第一版建议采用下面这条顺序：

1. 动作层先结算原始结果
2. 状态层再根据动作结果更新心率和体能
3. 状态修正回流到后续兑现与表现
4. UI 和视觉层最后读取状态

一句话：

- **先有原始动作结果**
- **再有状态变化**
- **最后才有状态驱动的表现和 UI**

## 21.2 为什么不能先更新状态再算动作

如果一帧开始就先让 `PlayerConditionModel` 更新，再去算这一拍动作，会有一个明显问题：

- 状态模型拿不到这一拍最新的动作结果

这样就会变成：

- 这一下动作要等到下一拍才影响心率和体能

后果是：

- 手感会慢一拍
- 因果会变糊
- 终盘加压感不够直接

所以顺序上必须保证：

- 当前动作先出结果
- 当前状态再对这个结果做响应

## 21.3 为什么 UI 不应先读状态

如果 UI 或表现层先读状态，再更新动作和状态模型，就会出现：

- 画面显示的是旧状态
- 当前这一下操作的反馈要延后一个循环

这对心率条尤其不好，因为你后面想让它成为主反馈。

所以建议：

- 心率条、疲态表现、冲刺状态表现都尽量读取本帧更新后的状态

## 21.4 最合理的一帧语义

我建议先把一帧的语义理解成下面这个流程：

### 第一步：动作层推进

当前这一帧里：

- `SwimmerMotor` 根据已有输入和已有动作队列
- 计算原始动作结果
- 计算原始推进脉冲
- 计算原始 `qualityScore`
- 计算原始 `pressureScore`

这一步的产物是：

- “当前动作事实”

### 第二步：状态层响应

拿到动作层结果后：

- `PlayerConditionModel.updateFromStroke(...)`
- `PlayerConditionModel.tick(dt)`

这一步负责：

- 更新心率
- 更新体能
- 更新区间
- 更新空体状态
- 更新 `qualityModifier`
- 更新 `efficiencyModifier`

这一步的产物是：

- “当前比赛状态事实”

### 第三步：兑现层应用修正

拿到状态层结果后，再把修正应用到：

- 当前动作收益兑现
- 终盘冲刺收益
- 表现权重

这一步的产物是：

- “当前帧最终有效结果”

### 第四步：前台读取

最后 UI、镜头、特效、角色表现读取：

- 当前心率
- 当前区间
- 当前体能
- 当前冲刺层级
- 当前疲态状态

这样前台看到的就是本帧最新状态。

## 21.5 第一版最稳的更新边界

为了避免第一版改动太大，我建议不要追求“一帧内多次复杂回流”。

第一版最稳的边界是：

- `SwimmerMotor` 先输出原始结果
- `PlayerConditionModel` 用这些结果更新自身状态
- 当前帧的最终表现和 UI 读取更新后的状态

但：

- 不必第一版就做到所有数值都在同一帧里反向再改一遍动作层内部过程

也就是说：

- 第一版先做“动作 -> 状态 -> 表现”
- 暂时不强求“状态再反向影响同一拍动作内部细节”

这会让改动范围小很多，也更容易调。

## 21.6 对当前工程最现实的理解

结合当前代码结构，第一版最现实的插入方式应该是：

### 当前已有事实

- `SwimmerMotor` 在 `Swimmer.update(dt)` 中推进
- `GameManager.update(dt)` 里做 UI 读取和部分表现读取
- `GameFlowController` 负责比赛流程编排

### 第一版建议

- 保留 `SwimmerMotor` 在 `Swimmer.update(dt)` 中产出原始结果
- 由上层在合适节点收集这些结果并喂给 `PlayerConditionModel`
- 再让 `GameManager.update(dt)` 或流程层读取更新后的状态做 UI / 表现

也就是说，第一版可以接受：

- 动作层仍然主要在 `Swimmer.update(dt)` 中运行
- 状态层在其后被驱动更新

## 21.7 第一版最关键的设计原则

我建议先定死下面这条：

- **同一帧内，状态模型至少要吃到本帧动作层的结果，再被前台读取**

这条原则比“必须在哪个具体函数里更新”更重要。

因为只要满足这条原则：

- 手感基本不会慢一拍
- 前台反馈基本不会错位

## 21.8 第一版不建议追求的复杂度

第一版不建议一开始就追求：

- 同一帧动作层先算一遍原始结果
- 状态层更新
- 再把状态回灌到动作层重算完整结果

这会让你第一刀改动非常重。

第一版更建议：

- 先把状态层插进去
- 先让状态层正确读取动作结果并更新自身
- 后续再逐步增强状态回灌深度

## 21.9 一条更适合第一版的落地线

如果要把顺序讲得非常简单，我建议第一版先按这条线实现：

1. `SwimmerMotor` 结算本拍动作结果
2. `PlayerConditionModel` 更新心率和体能
3. 本帧 UI / 表现读取新状态
4. 下一帧动作层再继续在新状态背景下运行

这条线的优点是：

- 逻辑顺
- 改动轻
- 调试容易

虽然它在极限上不是最完美的实时闭环，但对第一版非常够用。

## 21.10 当前阶段可以先定下来的共识

截至目前，这一块建议先形成如下共识：

- 动作层应先于状态层更新
- 状态层应先于 UI / 表现层读取
- 第一版优先保证“本帧动作 -> 本帧状态 -> 本帧表现”
- 第一版不强求同一帧内做深度回灌重算
- 更新顺序的关键不是挂在哪个函数，而是保证因果顺序正确

## 21.11 下一步建议

如果继续往下推，下一步最值得讨论的是：

- 第一版终盘中，领先者与落后者对 `sprintTier` 的触发阈值是否完全一致
- `pressureScore` 和 `qualityScore` 是否应在同一个结算节点上进入状态模型
- 第一版到底先落 `DiveResult`、`PlayerConditionModel` 还是 `RaceContext`


## 22. 动作摘要与跳水字段的真实数据来源

前面几节假设了 updateFromStroke(...) 的输入语义、pressureScore 的归属、以及 DiveResult 的字段集。这一节把这些假设和真实代码逐条对齐，修正偏差。

### 22.1 qualityScore 不需要新造，已有现成结构体

文档之前说 PlayerConditionModel 要吃一个连续的 qualityScore（0..1）。看代码后，它的天然来源已经存在：

SwimmerMotor.settleActionStrokeQuality(...) 会产出 StrokeQualityResult，字段包括：

- strokeQuality（0..1，已经过 freshness 加权）
- holdRatio
- meanRatio
- ratioStdDev
- sampleCount
- inputFreshness
- inputLeadRatio
- holdTimeValid
- badReason

也就是说，qualityScore 最直接的定义就是 strokeQuality 字段。第一版不需要新造一套质量评分，直接用 strokeQuality 映射即可。

修正点：文档之前把 qualityScore 描述为需要单独生产的连续值。实际上它就是 StrokeQualityResult.strokeQuality，不需要 SwimmerMotor 再额外产出一个新字段。

### 22.2 pressureScore 有现成来源，但它当前是废弃的

文档之前说 pressureScore 应由 SwimmerMotor 产出。看代码后发现一个更精确的事实：

项目里已经有一个专门做短窗强度摘要的类 StrokeMetrics（swimmer/StrokeMetrics.ts），它维护：

- armInputRate（手臂输入频率）
- kickInputRate（腿部输入频率）
- effortScore（0..1，相对目标频率的强度）
- syncScore（0..1，手腿同步度）

这正好是 pressureScore 想要的语义。但关键问题是：StrokeMetrics 当前没有被任何运行时代码使用。它是已实现但未接入的。

修正点：pressureScore 的第一版来源建议直接复用 StrokeMetrics.effortScore，而不是让 SwimmerMotor 从零再造一个短窗平滑值。但需要先把 StrokeMetrics 接进 SwimmerMotor 或 Swimmer 的 update 路径，否则它没有数据。

### 22.3 StrokeQualityResult 是事件型，不是连续型

文档之前在描述 updateFromStroke(...) 时，隐含假设动作结果是每帧可读的。看代码后需要修正：

SwimmerMotor 的稳定性结算只在动作结束时触发一次：

- 主动松手时：setStrokeHeld(type, false) -> setSideHeld -> settleActionStrokeQuality，立即返回
- 动作自然完成时：dvanceSideActions -> inishAction -> settleActionStrokeQuality，结果进 _pendingStrokeQualityResults 队列

也就是说，StrokeQualityResult 是事件型产出，不是每帧可读的连续值。

修正点：updateFromStroke(...) 的调用时机不是每帧一次，而是每次有 StrokeQualityResult 产出时一次。第一版的接口语义应该是事件驱动，而不是每帧轮询。tick(dt) 才是每帧调用，用于心率/体能的自然衰减和区间漂移。

### 22.4 DiveResult 物理字段的来源已完全明确

看 Swimmer.performDive(power) 后，DiveResult 候选字段的真实数据来源如下：

- entryDistance：lerp(DIVE_BALANCE.minDistance, DIVE_BALANCE.maxDistance, power)，现成
- entrySpeed：lerp(DIVE_BALANCE.minSpeed, DIVE_BALANCE.maxSpeed, power)，现成
- entryStyle：当前代码里不存在，现在只是 power > 0.72 ? PERFECT : power > 0.42 ? GOOD : BAD 这个三元映射，用于 splash 表现。DiveResult 里的 entryStyle 需要从这个映射新造，建议第一版先定 CLEAN / NORMAL / MESSY 三档，直接复用现有阈值
- qualityTier：当前没有独立的质量分级，只有 power 本身。第一版可以先用 power 映射成 LOW / OK / HIGH 三档，或者直接复用 entryStyle 的三档
- heartRateStartModifier / heartRateStartupWobbleModifier / optimalZoneEntryModifier：这三个是全新字段，当前代码完全没有对应物，需要新造，由 DiveResolver 根据 qualityTier 和 entryStyle 推导

### 22.5 跳水动画时长调度是 RaceManager 的副作用，不是 Swimmer 的

文档之前提到 startFromDive 还承担按动画时长调度切 RACING 的副作用。看代码后可以更精确地说：

- Swimmer.performDive(power) 返回 totalDuration（crouch + flight）
- RaceManager.startFromDive 用这个返回值 scheduleOnce 切到 RACING
- AI 路径直接 performDive，不经过 startFromDive，所以 AI 的状态切换靠 onStateChange 里的 RACING 分支兜底

修正点：改成 DiveResult 后，performDive(result) 仍然需要返回动画时长，否则 RaceManager 的调度会丢失依据。不能只改入参类型而不处理这个返回值链。

### 22.6 kickLaunch 机制是被忽略的终盘前置实现

文档一直说终盘冲刺没有任何加权。但代码里其实有一个未被完全利用的终盘前置机制：

SWIMMER_BALANCE 里有 kickLaunchDistanceStart = 15 和 kickLaunchDistanceEnd = 18，以及 earlySyncPenaltyDuringKickLaunch = 0.72。这暗示曾经设计过“距离进入 15..18 区间时触发 kick launch”的机制。

但搜索代码后发现，这些参数在 SwimmerMotor 和 Swimmer 里没有被实际引用。它们是预留的终盘参数，和 GLIDING 一样处于死代码状态。

修正点：第一版终盘机制不需要从零开始，可以复用这套预留参数的区间思路（distanceStart / distanceEnd 触发终盘进入），把 kickLaunch 语义改造成 sprint 进入。但需要确认这些参数确实是废弃的，而不是通过其他路径间接引用。

### 22.7 对接口设计的整体修正

基于以上发现，对前面几节做如下修正：

1. updateFromStroke(...) 的输入里，qualityScore 应直接对应 StrokeQualityResult.strokeQuality，不需要新造字段
2. pressureScore 第一版应复用 StrokeMetrics.effortScore，但需要先把 StrokeMetrics 接入运行时
3. updateFromStroke(...) 是事件驱动调用，不是每帧调用；每帧的心率漂移走 tick(dt)
4. performDive 改吃 DiveResult 后，仍需返回动画时长给 RaceManager 调度
5. entryStyle 和 qualityTier 第一版可以复用现有 power 阈值映射，不需要新造判定逻辑
6. 终盘进入可以复用 kickLaunch 的距离区间参数思路，不需要从零设计触发条件

### 22.8 下一步建议

如果继续往下推，下一步最值得讨论的是：

- StrokeMetrics 接入 SwimmerMotor 的具体方式：是让 SwimmerMotor 持有它，还是让 Swimmer 持有后把摘要传给状态层
- DiveResolver 应该放在哪个目录：core/ 还是 swimmer/
- kickLaunch 参数复用为终盘触发时，距离区间是按绝对距离还是按剩余距离百分比

## 23. 动作结算产出的两条路径与状态层接入点

第 22 节修正了 qualityScore 和 pressureScore 的数据来源。这一节继续往下拆，确认状态层到底应该挂在哪条产出路径上，以及当前代码里有哪些容易踩的接缝问题。

### 23.1 RhythmEvaluator 是死类，不是第二套判定系统

第 12.6.1 节之前把 RhythmEvaluator 列为"被忽略的第二套判定系统"。进一步核实后需要修正这个判断。

RhythmEvaluator 类（core/RhythmEvaluator.ts）虽然有自己的 combo、speedMultiplier、perfectWindow/goodWindow 逻辑，但搜索整个代码库后发现：

- 没有任何代码实例化或调用 RhythmEvaluator
- 它被引用的部分只有类型 RhythmResult 和 RhythmStats
- 实际运行时的节奏判定完全来自 SwimmerMotor 的 StrokeQualityResult

也就是说，RhythmEvaluator 是一个纯死类，只贡献类型定义。它不是"第二套并行判定系统"，而是"一套已经废弃的旧判定逻辑，只留下了类型外壳"。

修正点：第 12.6.1 节里"两套并行判定"的说法需要降级为"一套死类 + 一套活判定"。落地时不需要处理 RhythmEvaluator 的去留问题，只需要确认 RhythmResult 类型是否继续复用即可。第一版建议继续复用 RhythmResult 作为 UI 层的类型，状态层不用它。

### 23.2 动作结算有两条产出路径，产出物不同

当前代码里，一次划水动作的稳定性结算有两条触发路径，但它们产出的东西不完全一样：

路径 A：玩家松手时

- InputRouter -> GameFlowController.handlePlayerStrokeHeld(type, false)
- -> Swimmer.handleStrokeHeld(type, false)
- -> SwimmerMotor.setStrokeHeld(type, false) -> setSideHeld -> settleActionStrokeQuality
- -> 立即返回 StrokeQualityResult
- -> Swimmer.makeStrokeQualityResult 翻译成 RhythmResult
- -> GameFlowController 收到后直接 showRating + triggerPerfectFeedback
- -> 不进 _pendingRhythmResults 队列

路径 B：动作自然完成时

- Swimmer.update(dt) -> SwimmerMotor.update(dt)
- -> SwimmerMotor 内部 advanceSideActions -> finishAction -> settleActionStrokeQuality
- -> 结果进 _pendingStrokeQualityResults 队列
- -> Swimmer.update 里 consumeStrokeQualityResults 拉出
- -> makeStrokeQualityResult 翻译成 RhythmResult
- -> 进 _pendingRhythmResults 队列
- -> GameManager.update 里 consumePlayerRhythmResults 拉出
- -> showRating + playPerfectFlash + flashSplash

关键差异：

- 路径 A 的结果不经过队列，直接同步返回给 GameFlowController
- 路径 B 的结果经过两层队列异步消费
- 路径 A 不会触发 flashSplash，路径 B 会
- 两条路径都会触发 makeStrokeQualityResult，但调用者不同

修正点：如果 PlayerConditionModel 只挂在其中一条路径上，会漏掉另一条的动作结算。第一版必须确保两条路径的 StrokeQualityResult 都能到达状态层。

建议方案：在 Swimmer.makeStrokeQualityResult 里统一截取。因为两条路径都会经过这个方法，在这里截取 StrokeQualityResult 是唯一不会漏的点。具体做法是让 makeStrokeQualityResult 在翻译成 RhythmResult 之前，先把原始的 strokeQuality 等字段摘要出来，交给 PlayerConditionModel。

### 23.3 Swimmer 丢弃了原始 strokeQuality，只保留 Rating

Swimmer.makeStrokeQualityResult 做的事情是：

- 拿到 StrokeQualityResult（包含 strokeQuality: number 0..1）
- 通过 ratingForStrokeQuality(strokeQuality.strokeQuality) 映射成 Rating.PERFECT / GOOD / BAD
- 通过 rhythmResultFromStrokeQuality 构造 RhythmResult
- 丢弃原始的 StrokeQualityResult 引用

也就是说，RhythmResult 里虽然保留了 holdRatio、inputFreshness 等字段，但 strokeQuality 这个连续值被压成了三档 Rating。

修正点：PlayerConditionModel 需要的 qualityScore 是连续值（0..1），不能从 RhythmResult 里取。必须在 makeStrokeQualityResult 把 strokeQuality 压成 Rating 之前截取。

这和 23.2 的建议方案是同一个点：makeStrokeQualityResult 是唯一同时拿到连续 strokeQuality 和两条路径的交汇点。

### 23.4 lastStrokeQuality 是快照不是结算值

SwimmerMotor 暴露的 lastStrokeQuality getter 容易被误用。

- 它在 settleActionStrokeQuality 里被赋值为本次结算的 strokeQuality
- 但它不会在动作之间归零，下一次结算前它一直保持上一次的值
- GameManager.update 里读 currentStrokeQuality 就是读这个值，用于 UI telemetry

也就是说，lastStrokeQuality 是"上一次结算的快照"，不是"当前帧的实时稳定性"。如果 PlayerConditionModel 的 tick(dt) 需要知道当前稳定性来做心率漂移，它不能用 lastStrokeQuality，因为两次动作之间这个值不变。

修正点：tick(dt) 不应依赖 lastStrokeQuality 做实时心率计算。心率漂移应该基于"距离上次结算的时间"和"上次结算的 strokeQuality"来推导，而不是假设 lastStrokeQuality 是连续变化的。

### 23.5 Swimmer 对外暴露的 getter 清单

为了让状态层和表现层知道能从 Swimmer 读什么，这里列出 SwimmerMotor 当前对外暴露的全部 getter：

- currentSpeed（当前速度）
- distance（当前距离）
- isRacing（是否在比赛中）
- bodyPhase（身体相位，用于表现层起伏）
- armCycle / kickCycle（整体循环相位）
- leftArmCycle / rightArmCycle / leftKickCycle / rightKickCycle（分侧循环相位）
- armAction / kickAction（动作强度衰减值，用于表现层放大）
- lastStrokeQuality（上一次结算的稳定性快照）
- lastInputFreshness（上一次结算的输入新鲜度）
- currentAcceleration（当前加速度）
- actionCycleSeconds（当前动作周期时长）
- strokeTimingGuide（节奏引导信息，用于 UI）

修正点：第一版 PlayerConditionModel 不需要直接读这些 getter。它应该通过 makeStrokeQualityResult 的截取点拿到 qualityScore，通过 StrokeMetrics 拿到 pressureScore，通过 tick(dt) 做自然漂移。这些 getter 主要服务表现层。

### 23.6 对接口设计的进一步修正

基于以上发现，对 updateFromStroke(...) 的接入方案做如下修正：

1. qualityScore 的截取点不在 SwimmerMotor 里，而在 Swimmer.makeStrokeQualityResult 里，因为它才是两条产出路径的交汇点
2. 不需要让 SwimmerMotor 额外产出新字段，StrokeQualityResult.strokeQuality 已经够用
3. pressureScore 仍然建议复用 StrokeMetrics.effortScore，但需要先把 StrokeMetrics 接进 Swimmer.update 路径
4. tick(dt) 不能依赖 lastStrokeQuality 做实时心率漂移，应基于"上次结算值 + 距上次结算时间"推导
5. RhythmEvaluator 不需要处理，它是死类，继续复用 RhythmResult 类型即可

### 23.7 下一步建议

如果继续往下推，下一步最值得讨论的是：

- makeStrokeQualityResult 截取 qualityScore 后，通过什么方式传给 PlayerConditionModel：是回调、是队列、还是直接持有引用
- StrokeMetrics 接进 Swimmer.update 后，pressureScore 的更新频率是每帧还是每次动作结算
- Swimmer 是否需要新增一个对外的 consumeConditionInputs() 方法，类似现有的 consumeRhythmResults() 模式
## 24. 三个接入问题的判断

第 23.7 节留了三个问题，这一节给出判断。

### 24.1 qualityScore 通过什么方式传给 PlayerConditionModel

三个选项：回调、队列、直接持有引用。

判断：队列模式，复用现有的 consumeRhythmResults() 模式。

理由：

现有代码里 Swimmer 已经有一个成熟的队列模式：makeStrokeQualityResult 产出的 RhythmResult 进 _pendingRhythmResults，然后 GameManager.update 里通过 consumePlayerRhythmResults() 拉取。这个模式已经验证过，两条路径都能覆盖。

但有个关键问题：handleStrokeHeld 松手时（路径 A）返回的 RhythmResult 没有进队列，而是直接返回给了 GameFlowController。如果只加一个 _pendingConditionInputs 队列，路径 A 还是会漏。

所以更精确的方案是：在 Swimmer.makeStrokeQualityResult 里，翻译成 RhythmResult 之前，先截取一份摘要进 _pendingConditionInputs 队列。这样两条路径都经过 makeStrokeQualityResult，都不会漏。然后 Swimmer 新增一个 consumeConditionInputs() 方法，和 consumeRhythmResults() 对称，由 GameManager.update 在同一帧拉取。

不用回调的原因：makeStrokeQualityResult 的调用者之一是 GameFlowController.handlePlayerStrokeHeld，它已经在同步处理返回值。如果再加回调，调用链会变成同步返回加异步回调混合，调试时很难追踪。

不用直接持有引用的原因：Swimmer 是 Cocos 的 Component，生命周期挂在节点上；PlayerConditionModel 是纯数据对象，不应该被 Component 直接持有反向引用。这会把生命周期耦合在一起。

### 24.2 pressureScore 的更新频率：StrokeMetrics 每帧更新，但状态层按动作结算消费

两个选项：每帧还是每次动作结算。

判断：StrokeMetrics 每帧更新，但 PlayerConditionModel 每次动作结算时消费。

理由：

StrokeMetrics 的设计本身就是基于时间窗口的（inputRateWindowSeconds = 1.2），它需要在 update(dt) 里每帧 prune 过期输入、重算 effortScore。如果只在动作结算时更新，窗口内的输入频率就不准了，因为 recordStroke 只记录输入时刻，不记录没有输入这件事。

但 PlayerConditionModel 不需要每帧都读 effortScore。心率漂移走 tick(dt)，而 tick(dt) 不需要精确到每帧的 pressureScore，它只需要知道最近一段时间的压力趋势。所以 pressureScore 在每次动作结算时（和 qualityScore 同一个节点）被读一次就够了。

这样做的结果是：StrokeMetrics 在 Swimmer.update 里每帧调 update(dt) 加 recordStroke(type)，但它的 effortScore 只在 makeStrokeQualityResult 被调用时才被截取进 _pendingConditionInputs。tick(dt) 不读 StrokeMetrics。

### 24.3 Swimmer 是否需要新增 consumeConditionInputs()

判断：需要，而且应该和 consumeRhythmResults() 完全对称。

理由：

现有的 consumeRhythmResults() 模式有一个很好的特性：它让 Swimmer 不需要知道谁在消费它的结果。Swimmer 只负责产出，GameManager 负责拉取。这种单向数据流和第 21 节定的动作到状态到表现更新顺序完全一致。

如果改成直接持有引用，Swimmer 就需要知道 PlayerConditionModel 的存在，这破坏了现有分层。如果改成回调，Swimmer 就需要持有回调函数引用，生命周期管理变复杂。

新增 consumeConditionInputs() 后，GameManager.update 的流程变成：

1. Swimmer.update(dt) 里 SwimmerMotor 跑动作结算，StrokeMetrics 每帧更新
2. makeStrokeQualityResult 截取 qualityScore 加 pressureScore 进 _pendingConditionInputs
3. GameManager.update 里调 consumeConditionInputs() 拉取，喂给 PlayerConditionModel.updateFromStroke(...)
4. GameManager.update 里调 consumeRhythmResults() 拉取，喂给 UI（和现在一样）
5. PlayerConditionModel.tick(dt) 做心率/体能自然漂移

这样 qualityScore 和 pressureScore 在同一个结算点进入状态模型，和第 18 节的共识一致。

### 24.4 StrokeMetrics 应该挂在 Swimmer 而不是 SwimmerMotor 上

判断：StrokeMetrics 挂在 Swimmer 上，不挂 SwimmerMotor。

理由：

SwimmerMotor 的职责是动作判定和原始推进，它已经够重了（882 行）。StrokeMetrics 是输入频率统计，它的 recordStroke 和 SwimmerMotor.recordStroke 是同源事件但不同关注点。如果把 StrokeMetrics 塞进 SwimmerMotor，会让 SwimmerMotor 同时承担判定和统计两个职责。

挂在 Swimmer 上更自然：Swimmer.update 里每帧调 strokeMetrics.update(dt)，Swimmer.handleStroke 和 handleStrokeHeld 里调 strokeMetrics.recordStroke(type)。然后 makeStrokeQualityResult 里读 strokeMetrics.effortScore 作为 pressureScore。

### 24.5 一帧内的完整数据流

把上面四个判断合起来，一帧内的完整数据流如下：

路径 B（动作自然完成）：

1. Swimmer.update(dt)
   - SwimmerMotor.update(dt) 跑动作结算和推进
   - StrokeMetrics.update(dt) 每帧更新频率统计
   - SwimmerMotor.consumeStrokeQualityResults() 拉出结算结果（路径 B）
   - 对每个结果调用 makeStrokeQualityResult
     a. 截取 qualityScore = strokeQuality.strokeQuality
     b. 截取 pressureScore = strokeMetrics.effortScore
     c. 两者一起进 _pendingConditionInputs 队列
     d. 翻译成 RhythmResult 进 _pendingRhythmResults 队列

2. GameManager.update(dt)
   - consumeConditionInputs() 拉取，喂给 PlayerConditionModel.updateFromStroke(...)
   - consumeRhythmResults() 拉取，喂给 UI（和现在一样）
   - PlayerConditionModel.tick(dt) 做心率/体能漂移
   - 读 PlayerConditionModel 的 heartRate / energy / zone 做表现层 UI

路径 A（玩家松手）：

1. GameFlowController.handlePlayerStrokeHeld(type, false)
2. Swimmer.handleStrokeHeld(type, false)
3. SwimmerMotor.setStrokeHeld 产出 StrokeQualityResult
4. Swimmer.makeStrokeQualityResult
   a. 截取 qualityScore 加 pressureScore 进 _pendingConditionInputs
   b. 翻译成 RhythmResult 同步返回给 GameFlowController
5. GameManager.update 下一帧拉取 _pendingConditionInputs（和路径 B 一样）

注意：路径 A 的 RhythmResult 是同步返回的，但 qualityScore 加 pressureScore 仍然走队列。这意味着 UI 反馈是同步的，但状态层更新是下一帧。这是可以接受的，因为状态层更新晚一帧不会影响手感。

### 24.6 对 updateFromStroke(...) 输入的最终定义

基于以上判断，updateFromStroke(...) 的最小输入最终定义为：

输入：
- strokeAccepted: boolean（是否成功结算）
- qualityScore: number（0..1，来自 StrokeQualityResult.strokeQuality）
- pressureScore: number（0..1，来自 StrokeMetrics.effortScore）
- dt: number（距上次结算的时间间隔）

不传：
- phase（已在模型内部通过 setPhase 维护）
- StrokeType（状态层不需要区分左右）
- 原始输入事件
- holdRatio 等明细字段

第一版不传的：
- 速度修正量（应由状态层产出，不应作为输入）
- 心率区间（应由状态层计算，不应作为输入）

### 24.7 待确认问题

以下几个问题仍需后续讨论：

- _pendingConditionInputs 队列里存的是完整 StrokeQualityResult 还是精简后的 StrokeConditionInput
- PlayerConditionModel.tick(dt) 的大致逻辑：是否需要 qualityScore 加距上次结算时间来推导心率漂移，还是纯靠 heartRateZone 做自然衰减
- AI swimmer 是否也需要接 StrokeMetrics：如果接，AI 的 pressureScore 是否有实际意义（AI 的输入是自动生成的）
## 25. 第 24.7 节三个待确认问题的判断

### 25.1 队列里存完整 StrokeQualityResult 还是精简后的 StrokeConditionInput

判断：精简后的 StrokeConditionInput。

理由：

StrokeQualityResult 有 15 个字段，状态层只需要其中 3 个（strokeQuality、holdTimeValid、badReason 的有无）。把完整结构体塞进队列会让状态层意外暴露给动作层的内部细节，而且 StrokeQualityResult 的类型定义在 SwimmerMotor 里，状态层不应该直接依赖它。

精简后的 StrokeConditionInput 只需要：
- strokeAccepted: boolean
- qualityScore: number
- pressureScore: number
- dt: number

这个类型定义在状态层自己的文件里，不依赖 SwimmerMotor。

### 25.2 tick(dt) 的逻辑

判断：tick(dt) 需要上次结算的 qualityScore 加距上次结算的时间来推导心率漂移，不是纯靠 heartRateZone 做自然衰减。

理由：

纯靠 heartRateZone 做自然衰减意味着心率只会在区间边界做阶跃变化，中间是线性漂移。但真实的游泳节奏里，"连续几次高质量动作后心率逐渐上升"和"停顿后心率逐渐回落"都是连续过程。如果 tick(dt) 不知道上次结算质量，它就无法区分"玩家在高质量输出但还没到下一拍"和"玩家在停顿"。

tick(dt) 内部应维护：
- _lastQualityScore：上次 updateFromStroke 时更新
- _timeSinceLastStroke：每帧累加，updateFromStroke 时归零

心率漂移逻辑大致是：
- _timeSinceLastStroke 在合理范围内加 _lastQualityScore 高 -> 心率朝 OPTIMAL 或更高漂移
- _timeSinceLastStroke 超出合理范围 -> 心率朝 LOW 漂移
- heartRateZone 决定漂移的目标值和速率，而不是唯一驱动因素

### 25.3 AI 是否需要接 StrokeMetrics

关键发现：AI 的动作路径和玩家完全不同。

AI 通过 playAiStrokeVisual -> recordAiVisualStroke -> queueVisualSideStroke 只排队动画周期，不创建 StrokeAction，不触发 settleActionStrokeQuality，不产出 StrokeQualityResult。AI 的推进完全靠 SwimmerMotor.update 里的 aiPower 和 aiCruiseAccel 参数。

这意味着两个后果：

1. AI 不会经过 makeStrokeQualityResult，所以 AI 的 _pendingConditionInputs 队列永远是空的。如果 AI 也要有 PlayerConditionModel，它的状态更新不能靠 updateFromStroke，只能靠 tick(dt) 加 aiPower 等参数。

2. 如果给 AI 接 StrokeMetrics，它的 recordStroke 只会在 playAiStrokeVisual 时被调用，effortScore 会反映 AI 的划水频率。但 AI 的划水频率是由 AISwimmerController 的 _baseInterval 和 difficulty 决定的，是预设的，不是博弈出来的。所以 AI 的 pressureScore 有值但没有策略意义。

倾向：第一版 AI 不接 StrokeMetrics，AI 的 PlayerConditionModel 走简化路径。

具体做法：
- AI 的 PlayerConditionModel 只用 tick(dt) 更新
- AI 的心率/体能由 aiPower、difficulty、距离进度直接推导
- AI 不需要 updateFromStroke
- AI 的 pressureScore 固定为基于 difficulty 的常量

需要用户判断的点：AI 是否也需要完整的状态博弈（比如 AI 也会在终盘消耗体能冲刺），还是第一版 AI 只需要一个简化的状态用于表现层（比如 AI 也要显示心率条）？

如果 AI 也要有完整的状态博弈，那 AI 的输入路径需要改造，让 AI 的动作也经过 settleActionStrokeQuality。这是一个比较大的改动。

如果 AI 只是表现层需要（心率条显示），那简化路径就够了。

### 25.4 下一步建议

如果用户对 AI 简化路径的方向确认后，下一步最值得讨论的是：
- PlayerConditionModel 的完整接口签名（reset / setPhase / applyDiveResult / updateFromStroke / tick / updateSprintState）
- DiveResolver 的产出逻辑和放置位置
- 第一版代码的文件结构：新增哪些文件，每个文件放什么

## 26. AI 状态层的简化路径

用户判断：AI 不需要完整的状态博弈，AI 更重要的是做表现层面的东西，跟玩家的输入系统做出区分。

### 26.1 AI 和玩家的状态层差异

基于第 25.3 节的发现和用户的判断，AI 和玩家的状态层路径完全不同：

玩家路径：
- 输入经过 SwimmerMotor 的完整动作判定
- 产出 StrokeQualityResult，经 makeStrokeQualityResult 截取 qualityScore + pressureScore
- 通过 consumeConditionInputs() 喂给 PlayerConditionModel.updateFromStroke(...)
- tick(dt) 做心率漂移
- 玩家通过输入质量博弈心率区间和体能消耗

AI 路径：
- 输入经过 playAiStrokeVisual -> recordAiVisualStroke，只排队动画，不触发稳定性结算
- 不产出 StrokeQualityResult，不经过 makeStrokeQualityResult
- 不走 updateFromStroke，不接 StrokeMetrics
- AI 的 AiConditionModel 只用 tickAi 更新（不走 tick/updateFromStroke）
- AI 的心率/体能由 aiPower、difficulty、距离进度直接推导
- AI 的 pressureScore 固定为基于 difficulty 的常量

### 26.2 AI 状态层的推导逻辑

AI 的 AiConditionModel.tickAi 内部不依赖 qualityScore 和 timeSinceLastStroke，而是依赖：

- difficulty：决定 AI 的整体表现水平
- aiPower：决定 AI 的推进强度
- 距离进度（distance / raceDistance）：决定 AI 当前处于哪个阶段
- 当前是否进入终盘

推导规则大致是：
- 开局阶段：AI 心率快速进入 OPTIMAL，速度由 difficulty 决定
- 中段：AI 心率维持在 OPTIMAL 附近，波动幅度由 difficulty 的反比决定（难度越高越稳定）
- 终盘：AI 按难度决定是否消耗体能冲刺，高难度 AI 会更激进地消耗体能
- AI 的体能消耗是线性或预设曲线，不是博弈结果

### 26.3 AI 心率条是否显示

用户确认：AI 的心率条不显示给玩家看。AI 的心率纯粹是内部状态，只用于 AI 自己的表现层驱动（比如高心率时动画更激烈、终盘时体能消耗表现），不对 UI 暴露。

AI 的心率区间语义和玩家一致（LOW/OPTIMAL/HIGH_PRESSURE/OVERLOAD），但驱动方式不同（见 26.2）。区间只服务于 AI 表现层，不显示精确数值，也不显示区间颜色给玩家。

### 26.4 AI 终盘表现

AI 的终盘冲刺不需要玩家那套 sprintTier 博弈（STEADY/PUSH/GAMBLE），而是按 difficulty 参数自动表现：

- 低难度 AI：终盘不冲刺，维持匀速
- 中难度 AI：终盘温和加速，消耗少量体能
- 高难度 AI：终盘激进冲刺，大量消耗体能，可能在最后阶段反超或被反超

这样 AI 的终盘表现有差异，但不需要玩家那套输入驱动的 sprintTier 切换逻辑。

### 26.5 对接口设计的影响

AI 简化路径对接口设计的影响（最终结论见第 27.6 / 28.5 节）：

1. 玩家和 AI 不共用一个类，分成两个独立类：PlayerConditionModel（玩家用）和 AiConditionModel（AI 用）。两者实现相同的只读 getter 接口，但方法集不同。

2. AI 版只暴露 reset / setPhase / tickAi，不提供 updateFromStroke / applyDiveResult / updateSprintState；AI 不接 StrokeMetrics，不产出 StrokeQualityResult。

3. AI 版的心率、体能、qualityModifier、efficiencyModifier 全部由 aiPower / difficulty / 距离进度在 tickAi 内直接推导，不由 qualityScore / pressureScore 驱动。

4. AI 的状态输出只服务于 AI 表现层，不进 UI；玩家心率条只读玩家自己的 PlayerConditionModel。

### 26.6 下一步建议

AI 简化路径确认后，本节涉及的接口已在后续小节定稿：
- PlayerConditionModel / AiConditionModel 的完整接口签名见第 27 节
- DiveResolver 的产出逻辑和放置位置见第 28 节
- 第一版文件结构和落地顺序见第 28.5 / 28.8 节
## 27. PlayerConditionModel 完整接口签名

这一节把前面散落在各处的接口片段收拢成一份完整签名，和第 10/16/22/24/25/26 节的结论对齐。

### 27.1 类型定义

RacePhase、HeartRateZone、SprintTier 在第 7/9 节已定义，不重复。

新增的精简输入类型：

StrokeConditionInput（玩家用，事件驱动）：
- strokeAccepted: boolean
- qualityScore: number（0..1，来自 StrokeQualityResult.strokeQuality）
- pressureScore: number（0..1，来自 StrokeMetrics.effortScore）
- dt: number（距上次结算的时间间隔）

SprintConditionInput（终盘用，由 GameFlowController 驱动）：
- sprintTier: SprintTier
- dt: number

AiConditionInput（AI 专用简化输入，第 26 节确认）：
- aiPower: number
- difficulty: number
- progress: number（0..1，比赛进度）
- dt: number

### 27.2 玩家版接口

以下方法只服务于玩家 swimmer：

reset(): void
- 开新比赛时恢复默认状态
- 心率归到 LOW 区间下沿
- 体能恢复满
- sprintTier 归为 STEADY
- 内部 _lastQualityScore 和 _timeSinceLastStroke 归零

setPhase(phase: RacePhase): void
- 切换阶段时切换心率/体能更新解释
- 第一版阶段为 START / PACE / SPRINT / RESULT
- 不在这里做大幅心率跳变，只调整目标区间和漂移速率

applyDiveResult(result: DiveResult): void
- 把跳水结果映射到开局状态
- 读 heartRateStartModifier 调整心率起点
- 读 heartRateStartupWobbleModifier 调整前几拍稳定度
- 读 optimalZoneEntryModifier 调整进入 OPTIMAL 的难度
- 这个方法只在跳水结束时调一次

updateFromStroke(input: StrokeConditionInput): void
- 事件驱动，每次 makeStrokeQualityResult 产出时调用
- 更新 _lastQualityScore = input.qualityScore
- 归零 _timeSinceLastStroke
- 根据 qualityScore + pressureScore + 当前 phase 推动心率和体能变化
- 不在这里做心率自然漂移，那是 tick 的职责

tick(dt: number): void
- 每帧调用
- 累加 _timeSinceLastStroke += dt
- 根据 _lastQualityScore + _timeSinceLastStroke + heartRateZone 推导心率漂移
- 根据 heartRateZone + phase 推导体能消耗/恢复
- 更新 heartRateZone（当 heartRate 跨过区间边界时）
- 更新 energyDepleted（当 energy 归零时）
- 更新 qualityModifier 和 efficiencyModifier

updateSprintState(input: SprintConditionInput): void
- 由 GameFlowController 在终盘阶段驱动
- 设置 sprintTier
- 不同 tier 影响体能消耗速率和心率漂移目标
- STEADY：正常消耗
- PUSH：加速消耗，心率推向 HIGH_PRESSURE
- GAMBLE：极限消耗，心率允许短时 OVERLOAD

### 27.3 AI 版接口

AI 不调 updateFromStroke，不调 applyDiveResult（AI 的跳水结果走简化路径）。

AI 的 PlayerConditionModel 只用以下方法：

reset(): void
- 同玩家版

setPhase(phase: RacePhase): void
- 同玩家版

tickAi(input: AiConditionInput): void
- 每帧调用
- 心率由 aiPower + difficulty + progress 直接推导
- 体能由 difficulty + progress 推导消耗曲线
- 终盘自动按 difficulty 决定冲刺强度
- 不需要 _lastQualityScore 和 _timeSinceLastStroke
- 心率不显示给玩家（第 26.1 节确认），纯内部状态

### 27.4 状态层产出的修正量

PlayerConditionModel 对外暴露的只读 getter：

- heartRate: number
- heartRateZone: HeartRateZone
- energy: number
- energyDepleted: boolean
- sprintTier: SprintTier
- qualityModifier: number（影响动作收益兑现）
- efficiencyModifier: number（影响体能消耗速率）

这些 getter 由 GameManager.update 在 tick 之后读取，喂给表现层和 UI。

### 27.5 调用时序

玩家版一帧内的调用顺序：

1. Swimmer.update(dt) -> SwimmerMotor 跑动作结算
2. makeStrokeQualityResult 截取 qualityScore + pressureScore 进 _pendingConditionInputs
3. GameManager.update 拉取 consumeConditionInputs()
4. 对每个 input 调 playerCondition.updateFromStroke(input)
5. playerCondition.tick(dt)
6. GameManager 读 playerCondition 的 getter 做表现层和 UI

AI 版一帧内的调用顺序：

1. AISwimmerController.update(dt) -> swimmer.playAiStrokeVisual(type)
2. Swimmer.update(dt) -> SwimmerMotor.update 推进（不产出 StrokeQualityResult）
3. GameManager.update 调 aiCondition.tickAi({ aiPower, difficulty, progress, dt })
4. GameManager 读 aiCondition 的 getter 做 AI 表现层

### 27.6 一个关键区分

玩家版和 AI 版共用 PlayerConditionState 结构（第 9 节的字段集），但行为实现不同：

- 玩家版：updateFromStroke + tick，心率由动作质量驱动
- AI 版：tickAi，心率由难度参数驱动

第一版不建议做成继承或接口多态。建议直接做成两个类：
- PlayerConditionModel（玩家用）
- AiConditionModel（AI 用）

两者实现相同的 getter 接口，但方法集不同。GameManager 分别持有和驱动。

### 27.7 下一步建议

接口签名定下来后，下一步最值得讨论的是：
- DiveResolver 的产出逻辑和放置位置
- 第一版代码的文件结构：新增哪些文件，每个文件放什么
- RaceContext 最终持有的是 PlayerConditionModel 还是 ConditionModel 接口
## 28. DiveResolver 的产出逻辑、放置位置与第一版文件结构

### 28.1 DiveResolver 要解决的核心问题

当前跳水链路里，power 的解释被拆散在三层：

- GameFlowController.commitDive 里 calculateDivePower(charge) 算出 power
- RaceManager.startFromDive(power) 传给 Swimmer.performDive(power)
- Swimmer.performDive(power) 里 lerp 出 distance / entrySpeed / 动画时长 / splash 表现

AI 链更碎：GameFlowController.prepareAndScheduleAiDives 里直接算 power，然后 setTimeout 后 swimmer.performDive(power)，完全不经过 RaceManager。

DiveResolver 的职责是：把 power -> DiveResult 这一步解释统一收口，让玩家和 AI 都先产 DiveResult，再分别走各自的链。

### 28.2 DiveResolver 的产出逻辑

输入：power（0..1）

产出：DiveResult

产出逻辑分三类字段：

物理字段（复用现有 lerp，不新造逻辑）：
- entryDistance = lerp(DIVE_BALANCE.minDistance, DIVE_BALANCE.maxDistance, power)
- entrySpeed = lerp(DIVE_BALANCE.minSpeed, DIVE_BALANCE.maxSpeed, power)
- 动画时长（crouch + flight）仍由 Swimmer.performDive 内部计算，不由 DiveResolver 产出

表现字段（复用现有阈值映射）：
- qualityTier：power > 0.72 ? HIGH : power > 0.42 ? OK : LOW
- entryStyle：power > 0.72 ? CLEAN : power > 0.42 ? NORMAL : MESSY
- 这两个复用 Swimmer.performDive 里现有的 power > 0.72 / power > 0.42 阈值，不新造判定

状态修正字段（全新，由 DiveResolver 根据 qualityTier 推导）：
- heartRateStartModifier：高质量跳水把心率起点推向 OPTIMAL 下沿，低质量保持在 LOW
- heartRateStartupWobbleModifier：高质量跳水让前几拍更稳定，低质量更抖
- optimalZoneEntryModifier：高质量跳水让进入 OPTIMAL 更快，低质量需要更多拍数

第一版推导规则建议：
- HIGH/CLEAN：三个 modifier 都偏正面（起点高、稳定好、进入快）
- OK/NORMAL：中性
- LOW/MESSY：三个 modifier 都偏负面

具体数值第一版先用常量表，不做复杂计算。

### 28.3 DiveResolver 的放置位置

判断：放在 core/ 目录。

理由：
- DiveResolver 是纯函数或纯类，不依赖 Cocos Component 生命周期
- 它的输入是 power（数值），产出是 DiveResult（纯数据结构）
- core/ 目录已经有 GameBalance.ts（纯数值配置）和 StrokeQualityScoring.ts（纯函数），DiveResolver 和它们同类
- 不放 swimmer/ 目录，因为 swimmer/ 目录的东西都和 SwimmerMotor 强相关
- 不放 app/ 目录，因为 app/ 目录的东西都和流程编排强相关

建议文件名：core/DiveResolver.ts

### 28.4 DiveResolver 接入后两条链路的变化

玩家链路变化：
- GameFlowController.commitDive 里，calculateDivePower(charge) 仍然保留（charge -> power）
- 新增一步：DiveResolver.resolve(power) -> DiveResult
- RaceManager.startFromDive 改签名为 startFromDive(result: DiveResult)
- Swimmer.performDive 改签名为 performDive(result: DiveResult)
- Swimmer.performDive 内部读 result.entryDistance / result.entrySpeed 做物理初始化
- Swimmer.performDive 仍然返回动画时长（crouch + flight），给 RaceManager 调度用
- Swimmer.performDive 里读 result.entryStyle 做 splash 表现，替代现有的 power 阈值判断

AI 链路变化：
- prepareAndScheduleAiDives 里，aiDivePower 仍然保留（算出 power）
- 新增一步：DiveResolver.resolve(power) -> DiveResult
- swimmer.performDive(result) 直接调用（仍不经过 RaceManager）
- AI 的 DiveResult 仍然产，但 AI 不调 applyDiveResult（第 26 节确认 AI 走简化路径）

### 28.5 第一版文件结构

新增文件清单：

core/DiveResolver.ts
- resolve(power: number): DiveResult
- 纯函数，不依赖 Cocos

core/DiveResult.ts（或合并进 DiveResolver.ts）
- DiveResult 接口定义
- DiveQualityTier / DiveEntryStyle 类型定义

condition/PlayerConditionModel.ts
- 玩家版状态模型
- reset / setPhase / applyDiveResult / updateFromStroke / tick / updateSprintState
- StrokeConditionInput / SprintConditionInput 类型定义

condition/AiConditionModel.ts
- AI 版状态模型
- reset / setPhase / tickAi
- AiConditionInput 类型定义

condition/ConditionTypes.ts（或合并进各自文件）
- HeartRateZone / SprintTier / RacePhase / PlayerConditionState 共享类型

condition/RaceContext.ts
- 轻量上下文容器
- 持有 phase / playerCondition / aiConditions / latestDiveResult / sprintActive

swimmer/StrokeMetrics.ts
- 已存在，当前是死代码
- 第一版需要接进 Swimmer.update 路径

不新增的文件：
- 不新增 RhythmEvaluator 的替代品（它是死类，继续复用 RhythmResult 类型给 UI）
- 不新增 StrokeConditionInput 的独立文件（定义在 PlayerConditionModel.ts 里即可）

### 28.6 改动现有文件的清单

GameFlowController.ts：
- commitDive 里加 DiveResolver.resolve(power)
- startFromDive 调用改为传 DiveResult
- prepareAndScheduleAiDives 里加 DiveResolver.resolve(power)

RaceManager.ts：
- startFromDive 签名改为 (result: DiveResult)
- 内部调 Swimmer.performDive(result)

Swimmer.ts：
- performDive 签名改为 (result: DiveResult)
- 内部读 result 的字段替代 power lerp
- 新增 _strokeMetrics 字段和 update 路径接入
- makeStrokeQualityResult 里截取 qualityScore + pressureScore 进 _pendingConditionInputs
- 新增 consumeConditionInputs() 方法

GameManager.ts：
- 新增 _playerCondition / _aiConditions 持有
- 新增 _raceContext 持有
- update 里加 consumeConditionInputs + tick + tickAi 调用

### 28.7 RaceContext 最终持有的是什么

判断：RaceContext 持有 PlayerConditionModel，不持有 AiConditionModel。

理由：
- RaceContext 的定位是"本局比赛的共享上下文"（第 3 节），不是"所有 swimmer 的状态容器"
- AI 的状态是 AI 自己的内部状态，不需要放进共享上下文
- GameManager 自己持有 _aiConditions 数组即可
- RaceContext 只需要 playerCondition 用于跨层共享（GameFlowController 读它驱动 sprint，UI 读它显示心率）

如果后续需要 AI 状态也进上下文，再加不迟。

### 28.8 第一版落地顺序（更新版）

结合第 14 节和第 28 节的所有结论，更新后的落地顺序：

1. 新增 core/DiveResolver.ts + DiveResult 类型
2. 改 Swimmer.performDive(result) + RaceManager.startFromDive(result)
3. 改 GameFlowController 两条跳水链路加 DiveResolver
4. 新增 condition/ConditionTypes.ts（共享类型）
5. 新增 condition/PlayerConditionModel.ts
6. 接 StrokeMetrics 进 Swimmer.update
7. 改 Swimmer.makeStrokeQualityResult 截取 + 新增 consumeConditionInputs
8. 改 GameManager.update 接入状态层
9. 新增 condition/AiConditionModel.ts
10. 新增 condition/RaceContext.ts
11. 逐步接 UI / 表现层到新状态

每一步都可以单独验证，不依赖后续步骤。

### 28.9 下一步建议

文件结构和落地顺序定下来后，原本待定的三个数值口径已在第 29 节定稿：
- 心率用 0..100 绝对值；四区间分界点见第 29.1 节
- 体能用总量 100 的绝对值；逐拍消耗与终盘倍率见技术笔记
- 终盘触发与 DiveResult 修正字段见第 29.2 / 29.3 节

## 29. 三个规则参数的最终定值

### 29.1 心率四区间分界点

心率数值范围：0..100（面向玩家显性反馈，比 0..1 更直觉）。

四个区间：

- LOW：0-50。状态没拉起来，效率偏低。
- OPTIMAL：50-80。动作最顺，体能利用率最高。最宽的区间，给中段玩法留容错空间。
- HIGH_PRESSURE：80-92。主动拉速度，风险与成本上升。窄区间，需要有意进入。
- OVERLOAD：92-100。搏命区，适合终盘短时爆发。最窄区间。

设计意图：OPTIMAL 最宽（30 个点），让中段能长时间维持；HIGH_PRESSURE 和 OVERLOAD 递减宽度，让高心率区成为有意选择而非默认状态。

### 29.2 终盘进入触发条件

触发方式：按剩余距离百分比，不按绝对距离。

统一比例：剩余距离占总赛程的 15% 时进入终盘。

- 50 米赛程：距离 42.5 时进入（剩 7.5 米，约 2 秒）
- 100 米赛程：距离 85 时进入（剩 15 米，约 4 秒）
- 200 米赛程：距离 170 时进入（剩 30 米，约 8 秒）

第一版不做赛程差异化。200 米终盘偏长的问题后续通过终盘内心率消耗速率补偿，不改触发线。

kickLaunchDistanceStart / kickLaunchDistanceEnd 这套预留绝对距离参数不直接复用，但复用其"距离区间触发"思路，改成百分比版本。

### 29.3 DiveResult 三个心率修正字段的推导规则

qualityTier 和 entryStyle 的映射（复用现有 power 阈值）：

- power > 0.72 -> qualityTier = HIGH, entryStyle = CLEAN
- power > 0.42 -> qualityTier = OK, entryStyle = NORMAL
- power <= 0.42 -> qualityTier = LOW, entryStyle = MESSY

第一版 qualityTier 和 entryStyle 一一对应，不拆开。

heartRateStartModifier（开局心率起点，10..45）：

由 power 线性映射，就是开局心率值本身：

- power = 0 -> startModifier = 10（LOW 下沿）
- power = 0.42 -> startModifier ≈ 22
- power = 0.72 -> startModifier ≈ 35
- power = 1 -> startModifier = 45（接近 OPTIMAL 下沿 50，但不直接进入）

好跳水让玩家开局接近 OPTIMAL，但仍需几拍才能进入。

heartRateStartupWobbleModifier（开局前几拍波动乘数，0..1）：

- HIGH / CLEAN -> 0.3（波动很小，心率平稳爬升）
- OK / NORMAL -> 0.6（中等波动）
- LOW / MESSY -> 1.0（满波动，心率忽上忽下）

只在开局前几拍（约前 5 拍）生效，之后归 1.0，心率波动完全由动作质量决定。

optimalZoneEntryModifier（进入 OPTIMAL 所需拍数）：

- HIGH / CLEAN -> 2 拍（几乎立刻进入）
- OK / NORMAL -> 4 拍
- LOW / MESSY -> 7 拍

用拍数而非秒数，让心率变化和动作节奏挂钩：玩家划得快就进得快，划得慢就进得慢。连续高质量动作的意义因此更明确。

和 heartRateStartModifier 配合：起点高加进入快等于好跳水的开局优势；起点低加进入慢等于差跳水的开局劣势。

### 29.4 三个问题的依赖关系

这三个问题有先后依赖：

1. 心率区间分界点必须先定（定义了 OPTIMAL 在哪里）
2. 终盘触发条件其次（定义了 SPRINT 阶段何时开始）
3. 跳水修正字段最后（依赖 OPTIMAL 的位置来定起点和进入拍数）

### 29.5 下一步建议

规则参数定完后，设计层的核心共识基本齐了。下一步最值得讨论的是：

- 第一版代码的实际文件内容和接口签名的最终确认
- 是否需要把以上规则参数集中放到一个 balance 配置文件里（类似现有 GameBalance.ts）
- 是否需要开始写代码
