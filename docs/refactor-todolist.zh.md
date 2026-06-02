# Refactor Todo List

本文档记录当前重构和玩法扩展后续待办事项。优先级从上到下排列，建议按批次实现、验证、提交。

## 1. GameManager 继续瘦身

- [x] 拆 `InputRouter`，统一处理 `arm-stroke`、`leg-kick`、`dive-release` 等事件。
- [x] 拆 `UIFlowController`，管理开始页、比赛 HUD、结果面板、跳水提示。
- [x] 拆 `DebugLogController`，集中 debug 日志、debug panel 显示、发布版开关。
- [ ] 让 `GameManager` 最终只保留 bootstrap、模块创建和生命周期。

目标：继续降低 `GameManager` 的协调负担，让它更像场景入口，而不是功能聚合类。

## 2. CartoonSwimmerRig 继续拆分

- [x] 拆 `CharacterAnimationPlayer`，负责动画 clip 播放、暂停、速度控制。
- [x] 拆 `CharacterDebugController`，负责模型 debug 模式、debug 输入频率、debug 摄像机辅助逻辑。
- [ ] 拆 `CharacterPoseStateController`，负责赛前站姿、跳水、游泳、结束姿态切换。
- [ ] 让 `CartoonSwimmerRig` 更像一个角色表现层 facade。

目标：把动画、debug、姿态状态从角色外壳里继续剥离，便于后续替换人物模型。

## 3. 跳水与开局完善

- [ ] 微调跳台站位 `DIVE_PLATFORM_NODE_OFFSET`。
- [ ] 给跳水动作增加更自然的身体前倾和入水姿态。
- [x] 增加入水后的短暂滑行阶段。
- [x] 滑行阶段允许速度衰减，但暂时禁止普通划水输入。
- [x] AI 跳水参数从硬编码迁移到 AI profile。

目标：让开局从“跳水 tween”升级为完整的出发动作段，并给不同 AI 留出明确参数。

## 4. 比赛流程扩展

- [x] 增加 `GLIDING` 状态。
- [x] 增加触墙/冲线动作。
- [x] 增加名次展示。
- [x] 增加赛后统计：时间、平均速度、最长 combo、Perfect/Good/Miss 数。
- [ ] 预留领奖台流程接口。

目标：把比赛从“开始-游-结束面板”扩展成完整赛事流程。

## 5. 配置集中化

- [x] 新建 `GameBalance.ts`，集中比赛距离、倒计时、速度、疲劳、跳水和 AI 节奏参数。
- [x] 新建 `ResourcePaths.ts`，集中模型、泳池、水面、水花、描边资源路径和动画 clip 名。
- [x] 新建 `InputTuning.ts`，集中节奏窗口、输入频率窗口、输入去重参数。
- [x] 减少散落在 `Swimmer.ts`、`GameFlowController.ts`、`SwimPhysicsModel.ts` 里的核心玩法 magic number。

目标：降低调参成本，让玩法、资源路径和输入手感都有明确归属。

## 6. 测试与验证

- [ ] 为 `RhythmEvaluator` 增加脚本级测试。
- [ ] 为 `StrokeMetrics` 增加输入频率/同步度测试。
- [ ] 为 `SwimPhysicsModel` 增加速度曲线测试。
- [ ] 为跳水 power 计算和 AI 反应时间增加测试。
- [ ] 继续保留当前 tsc 编译基线：

```bash
npx --yes --package typescript tsc --noEmit --ignoreDeprecations 6.0 --skipLibCheck
```

目标：让核心玩法逻辑有可重复验证方式，减少每次改手感都只能靠人工跑一局。

## 7. Cocos 构建配置确认

- [ ] 在 Cocos 构建面板确认启动场景为 `Login.scene`。
- [ ] 场景列表确认包含 `Login.scene` 和 `MainGame.scene`。
- [ ] 浏览器构建验证：登录页不加载泳池/人物，进入比赛后再加载。
- [ ] 微信小游戏构建验证资源路径和包体。

目标：确保登录场景和比赛场景的加载边界在发布包中也成立。

## 建议下一步

优先做第 1 项 `GameManager` 继续瘦身或第 2 项 `CharacterPoseStateController`。玩法输入改动暂时不放在当前重构列表里，等方向重新确定后再单独设计。
