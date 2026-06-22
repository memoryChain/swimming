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
  heartRateStabilityModifier: number;
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

