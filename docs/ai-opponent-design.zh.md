# AI 对手设计

2026-09-13：当前采用逐角色策略、独立等级与智力，规则和逐角色策略见 [AI重做设计与验证](AI重做设计与验证.zh.md)，量化结果见 [AI离线基准结果](AI离线基准结果.zh.md)。

身体能力通过 `resolveModifiersFromDigest({characterId, level})` 与玩家共用；赛事配置在 `AiRaceConfig.ts`，输入控制在 `AISwimmerController.ts`，资源决策在 `AiRacePlanner.ts`。四个正式智力档及独立变态测试档不改变身体属性或共享玩法规则。

原来的性格随机搭配、统一最高档倍率、追赶补偿和AI互撞免前进阻挡已移除。200米与400米使用各自资源预算。模型、体重、蓄气资质、心率特性和固有能力全部与角色身份对应。
