# 生涯AI配置说明

主配置：`assets/scripts/progression/CareerAiConfig.ts`。`CAREER_AI_EVENTS`按六级联赛排列，每级的`league`与`cup`各轮分别配置，联赛数据不再隐式推导杯赛数据。默认等级范围与各轮行为难度保留本次重构前的设定。

## 配置方法

`ai(最低等级, 最高等级, 行为难度列表, 角色权重列表)`。

```ts
// 本级联赛为1v1，对手是8级普通难度的肌肉男。
league: ai(8, 8, ['normal'], [
    { characterId: 'muscleMan', weight: 1 },
]),

// 杯赛每一轮单独填写，可与联赛完全不同。
cup: [
    ai(5, 8, ['rookie', 'rookie', 'normal', 'normal', 'normal', 'normal', 'normal'], [
        { characterId: 'cartonSwimmer6', weight: 3 },
        { characterId: 'muscleMan', weight: 1 },
    ]),
    ai(10, 10, ['expert'], [
        { characterId: 'muscleMan', weight: 1 },
    ]),
],
```

- 角色按相对权重独立有放回抽取，允许同场重复。3:1表示每个AI分别有75%和25%的概率，不保证单场恰好三比一。
- 只写一个正权重角色，全场AI都使用该角色。权重0不会出现；不需要凑到100，允许正小数。
- 不填写第四个参数时，生涯默认使用本文件的`DEFAULT_CAREER_CHARACTERS`，当前11个角色等权，可重复。修改默认池会影响所有沿用它的比赛；仅改一场时在该场填写独立数组。
- 难度列表长度就是实际AI人数，当前8泳道支持1～7项。`['expert']`是1v1；3项就是玩家加3名AI；7项就是满场8人。只打乱已配置名额的站位，多余泳道为空，不循环补齐。角色分别按权重抽取，人数由`ai()`自动推导，不用另外填写。
- 等级在闭区间内均匀抽取；最低和最高相同即固定等级。角色共用该场等级范围，不根据玩家培养等级改变。
- 前三级杯赛配置2轮（预赛、决赛），后三层配置3轮（预赛、半决赛、决赛）。本表只配AI，轮数与距离仍由`CareerRules.ts`控制。
- 行为参数定义仍在`competitor/AiRaceConfig.ts`的`AI_INTELLIGENCE`；新手、普通、高手、专家对应`rookie / normal / skilled / expert`，`extreme`仅供测试使用。

## 角色ID

| 角色 | characterId |
|---|---|
| 蛙妹 | `cartonSwimmer6` |
| 蛙少 | `cartonSwimmer8` |
| 超级腿 | `cartonSwimmer5` |
| 猫姐 | `cartonSwimmer9` |
| 忍者哥 | `cartonSwimmer10` |
| 健身教练 | `cartonSwimmer11` |
| 飞毛腿 | `cartonSwimmer12` |
| 潜水哥 | `cartonSwimmer13` |
| 风火轮 | `cartonSwimmer14` |
| 机甲coser | `cartonSwimmer15` |
| 肌肉男 | `muscleMan` |

## 校验、生效与存档

空角色池、全零、负数、非有限权重、重复角色ID、不存在的角色、空难度列表和越界等级会拒绝，不会静默换成其他阵容。单人开赛前校验，并将等级、难度和角色权重复制到本轮凭据；重载存档后保留本轮快照，修改配置作用于下一次开赛。杯赛未锁整届配置，下一轮会读取最新轮次配置。

阵容使用SharedRNG抽取，同种子、同配置及同调用顺序能复现。未提供characterWeights的旧凭据、快速比赛和好友房间保留原有全角色打乱方式；好友仍无成长奖励，未修改联网数据协议。

测试覆盖：逐轮配置读取、单角色全场、0权重排除、9:1分布、种子复现、非法池拒绝、凭据复制及存档往返。此配置当前随客户端代码发布，未新增在线热更新或调参UI。

人数调整不自动改写杯赛晋级名次规则：当前预赛前四、半决赛前三、决赛冠军。配置少人数预赛时可能所有完赛者都满足晋级名次；配置决赛1v1则仍需第一名夺冠。

## 少人数比赛的泳道

生涯按玩家加AI的总人数使用连续居中的泳道，玩家在这些泳道中按比赛种子随机抽签，AI填充其余位置，不占外侧空泳道。

| AI人数 | 实际占用泳道（从1开始） |
|---|---|
| 1 | 4、5 |
| 2 | 3～5 |
| 3 | 3～6 |
| 4 | 2～6 |
| 5 | 2～7 |
| 6 | 1～7 |
| 7 | 1～8 |

奇数总人数向较小泳道编号一侧取整。公共计算位于`competitor/RaceLaneAllocation.ts`，开赛玩家位置、AI创建和泳道选手映射共用此规则。联机保留原房间泳道安排。
