# 玩法运行时职责与接口

更新：2026-09-13。本文替代早期关于 pressureScore、冲刺档位和心率强耦合的接口讨论，保留现行接入责任。数值规则见 [游戏数值与手感配置](游戏数值与手感配置.zh.md)，网络时序与实际设备问题见 [联机架构第 8 节](平台能力/realtime-multiplayer-notes.zh.md)。

## 职责边界

| 模块 | 当前职责 |
| --- | --- |
| `core/GameManager.ts`、`app/GameFlowController.ts` | 加载配置、组装系统、路由输入及比赛流程；不重复实现心率曲线 |
| `core/InputRouter.ts` | 显式左右输入、长按分类、短按踢腿及释放事件 |
| `swimmer/SwimmerMotor.ts` | 动作队列、基础预支与释放预算、每划判定快照、移动与轮速 |
| `swimmer/SwimPhysicsModel.ts` | 推进、阻力及速度积分 |
| `condition/StrokeHeartRateModel.ts` | 实际起划时间环形队列、目标心率与角色升降响应 |
| `condition/PlayerConditionModel.ts` | 玩家体力结算、消费 Motor 心率、对外状态快照 |
| `condition/AiConditionModel.ts` | 真正 AI 按实际结算扣体力、消费 Motor 心率及权威状态 |
| `entity/Swimmer.ts` | 联结身体、Motor 与表现；投递动作结算，特殊动作期间推进心率时钟，海豚跳冻结数值 |
| `progression/PlayerBalanceOverrides.ts` | 角色基值和整数等级成长解析成赛内覆盖 |
| `progression/RaceModifiers.ts` | 本地/联机共用角色 ID 与等级解析、应用覆盖 |
| `competitor/SwimmerFactory.ts`、`CompetitorManager.ts` | 创建/重选 AI 模型，同步设置固有体重及心率特性 |
| `core/RaceManager.ts` | 状态、计时、进度、触壁、完赛倒计时与排名 |
| `camera/RaceCameraDirector.ts` | 消费精简比赛快照、控制镜头 |
| `ui/RaceHudStatusView.ts`、`RaceStrokeView.ts` | 消费显示状态和每划判定快照，不决定玩法 |

## AI 发令出发

`GameFlowController.startAiDivesAtGo()` 在进入 DIVING 的状态边缘同步发动真正 AI，以一次性标记防止重复调用；不再创建逐 AI 的 setTimeout。`aiDivePower()` 保留共享随机的蓄力差异，远端真人和隐藏泳者不参与。`Swimmer.performDive()` 统一使用 `DIVE_BALANCE.takeoffAnticipationSeconds`，下蹲和离台等待不依赖 power 或飞行时长；同帧提交才能同帧离台，远端网络晚到仍沿权威位置校正处理。

## 角色体力预算

角色初始体力80～150点，直接来自 `PlayerCharacterConfig.ts`，30级增加29点。面板、赛内体力上限与远端角色digest统一解析，不缓存旧基值，不修改存档等级或付费记录。体重和爆发同时占优者让出体力；仅角色表调整，不新增每帧成本。真正AI继续使用共享默认上限。

## 耗尽后的动作与推进

`ConditionBalance` 统一提供耗尽推进0.15、轮速0.6。`PlayerConditionModel`／`AiConditionModel`／`RemoteSwimmerController` 从同一体力比例条件解析，正体力不降频。`SwimmerMotor` 的动画和动作进度共用轮速，改变倍率不清空当前进度；推进仍在起划时锁定。海豚扣费与联机AI步末结算后同时刷新两项倍率。停划和踢腿不回体力，独立踢腿与特殊动作初速保留既有规则，重开复位；不增加每帧分配、定时器或网络字段。

## 爆发力的生效边界

`PlayerBalanceOverrides.burstLaunchSpeedScale` 由角色爆发力及整数等级成长解析，增幅读取 `BURST_BALANCE.speedGainPerPoint`（调参键 `burst.speedGainPerPoint`，默认 0.006），只用于 `DiveResolver` 出发初速与 `SwimmerRacePhases` 海豚弹射初速；翻滚蹬墙读取独立的 `burstWallLaunchSpeedScale`，由 `BURST_BALANCE.wallSpeedGainPerPoint`（调参键 `burst.wallSpeedGainPerPoint`，默认 0.018）解析。`SwimPhysicsModel` 的常规上限和高速推进衰减统一读 `SWIMMER_BALANCE.maxSpeed`，不接收角色速度覆盖。三处不重复叠乘；蹬墙每次从基准重算。普通 AI 没有玩家养成覆盖，倍率为 1。

出发跳水在 owner 侧先完成爆发加成，再发送最终 launchSpeed，远端直接采用该值；海豚和蹬墙从已有角色 ID/等级 digest 分别解析对应倍率，各端规则一致。不新增网络字段。

## 心率与体力的事件边界

实际起划在 Motor 的 `startActionBaseAcceleration()` 记录一次心率事件；按下、重复请求、释放和结算不能重复登记。每划开始保存心率与 PERFECT 边界，HUD 与释放判定读同一快照。

普通划水体力在动作结算后扣除，不在起划时重复扣。海豚跳成功时通过 `onDolphinJumpEnergyCost` 同步调用对应条件模型的 `consumeEnergy()`，立即刷新耗尽推进倍率；本地玩家和真正 AI 在创建时绑定，重复绑定覆盖原回调。远端真人回放不扣费，读取 owner 权威体力；既有 AI 快照也携带扣费后的比例。耗尽推进倍率在新划开始锁定，已在途预算不变。玩家、真正 AI 和远端真人必须区分，远端真人消费 owner 状态，不再套一遍 AI 体力消耗。

心率模型只保留一个模拟时钟：普通移动随 Motor 更新；转身等绕过普通更新的阶段自然恢复；海豚起跳至落水调用冻结更新，只让采样历史过期、不改变心率值；纯视觉动画推进不能再次积分。`reset()` 清空记录并回到 80，保留角色特性；换角色通过 `setPlayerBalance()` 或 `setHeartRateTrait()` 更新特性。

`conditionQualityScale()`、旧 cadence 修正等兼容接口目前保持中性，不能据其命名推断仍在改变判定。旧 effort、pressure、冲刺阶段和出发跳水修正字段不能绕过共享模型重新引入心率或体力计算。海豚跳的 `dolphin.strainHr` 已重新接入唯一 Motor 模型：成功发起时增加一次，远端接受动作不重复增加。海豚体力成本独立于手臂结算次数，不伪造五次划水事件，避免污染统计和心率采样。条件模型的旧同名接口保持空操作，避免双重结算。

## 联机接入

真人通过已有角色 ID/等级 digest 在每端解析相同属性；角色心率特性不需要新浮点报文字段。真实 AI 根据同步生成的模型身份取同一角色定义，不引入额外随机调用。

持续心率：真人 owner 权威，真正 AI 房主权威。划水事件携带该次心率快照，远端只在起划时临时应用，之后恢复较新的持续 owner 状态。事件的已锁定边界不被后续校正移动。混合预测与校正不能改成只依靠远端自己的模拟推断。

所有新增逐泳者可见状态都要判断是否需要权威同步；沿用既有网络会话门控、固定步和报文顺序，不在 UI 热路径增加模拟或日志。当前玩法协议 v40。

## 表现与性能

HUD 文字最多按约 10 Hz 采样，量化并比较后再写 `Label.string`。心形等动画约 30 Hz 更新，普通动态 Graphics 只在像素宽度/颜色变化时重画。隐藏调试界面立即返回，避免字符串、节点写入和临时对象分配。

跳水、转身与海豚的轨迹仍由 `DiveResolver.ts`、`entity/SwimmerRacePhases.ts` 及相应专项配置管理。数值讨论不改变相机、资源加载或动作采样职责；不恢复旧稿的“只有位置翻转，没有转身”结论。

## 技巧推进

`resolvePlayerBalance()`将角色技巧与等级解析为`strokePropulsionScale`，Motor起划时将其与耗尽倍率共同保存到动作，覆盖按住与松手的完整推进。旧`strokeQualityAccel`和`perfectComboMaxOvercap`角色覆盖删除；参考84点的质量比例固定保留。没有新增wire字段；真人仍通过角色ID／等级digest解析同一倍率，普通AI保持原基础推进。技巧不直接修改偏航、侧滚、PERFECT边界、心率、踢腿或起跳初速。单机调参变化重新解析倍率，联机沿用既有会话隔离。
