# 调参加载与保存指南

更新：2026-09-12。具体规则和已确认数值统一维护在 [游戏数值与手感配置](游戏数值与手感配置.zh.md)，这里只解释如何修改、加载和核对，避免多份数值表漂移。

## 配置结构与优先级

`assets/resources/config/tuning.json` 当前为 v37。`values` 是稳定英文 ID 对应的数值，`updatedAt` 是保存时间，`version` 用于兼容性诊断和迁移提示；版本号本身不是选用哪个文件的优先级。

1. 源码配置提供默认值，启动前记录默认快照。
2. `GameManager.onLoad()` 在创建运行时系统前异步加载项目 `config/tuning`。
3. 原生可写目录和 localStorage 的有效保存，按更新时间选择；仅比项目基线更新的本地候选覆盖项目。
4. 加载后按调参定义限制范围并校正参数关系。旧键会做兼容迁移，非法值忽略，未知键警告。

因此修改项目 JSON 后，应核对日志中的加载来源，不能只凭版本号断定当前预览正在用新值。项目配置已更新，当前运行中的游戏需要重新加载才能读到文件；本工具不会自动启动或重启 Creator。

## 修改入口

- 模型调试面板：参数定义、说明、上下限、步长和保存逻辑都在 `assets/scripts/core/TuningDebugControls.ts`。实际范围与说明以这个注册表为准。
- 单角色属性及心率特性 ID：编辑 `assets/scripts/app/PlayerCharacterConfig.ts`。
- 共用规则默认值：运动读 `GameBalance.ts`，输入与基础判定读 `InputTuning.ts`，体力与心率读 `ConditionBalance.ts`。
- 项目交付值：保存到 `assets/resources/config/tuning.json`，同时维护已确认规则的源码默认值。

新增手感参数必须接入调参面板，使用稳定英文键，并保存进项目 JSON。固定角色特性不塞进成长倍率或体重公式。

保存按钮会优先尝试项目文件，随后按环境写原生文件或 localStorage；以返回的保存位置为准。提示“临时保存到 localStorage”不意味着项目 JSON 已修改。

## 按问题找参数

| 要改的感觉 | 优先改什么 |
| --- | --- |
| 换手按住时缺推进 | `speed.strokeHeldBaseRatio`，同时看基础预算是否重复支付 |
| PERFECT 晚松不如提前 GOOD | `speed.strokeGoodPropulsionScale`、`speed.strokeTimeCompensation`，验证完整区间 |
| 动作太快或太慢 | `strokeQuality.armCycle*`、`motion.heldMotionSpeedScale` / `releasedMotionSpeedScale` |
| 滑行掉速太快 | `speed.poolDeceleration`、`baseDrag`、`highSpeedDrag` |
| 高心率太容易或太难 | `heartRate.widthAt120/140/160`、`minimumWidth` |
| 某类角色升温/降温太快 | 对应特性的 `heartRate.*RiseSeconds` / `*RecoverySeconds`；均衡使用 `riseSeconds` / `recoverySeconds` |
| 所有人同样划频的目标心率不对 | `heartRate.bpmPerStrokeHz`；采样缓冲读 `sampleSeconds` |
| 能满力划多少次 | 角色体力及 `condition.strokeDrain` |
| 力竭后还能游多快 | `condition.exhaustedPropulsionScale`，不能直接当作最终速度倍率 |
| 海豚跳体力负担 | `dolphin.staminaCost`，成功一次扣除固定点数，不足扣零，独立于每划成本 |
| 海豚跳心率负担 | `dolphin.strainHr`，成功释放一次性增加，起跳至落水冻结 |
| 踢腿过强 | `speed.kickAccelPerHz`、`kickCadenceMaxHz`、`kickMaxSpeed` |
| 大体型碰撞优势 | 角色 `weight`、`collision.weightContrastExponent` |

## 校验和复现

加载/保存会整理 GOOD 与 PERFECT 起止范围，限制在超时边界内；高速轮速不低于低速轮速，轮速速度窗口终点必须大于起点。心率宽度节点按顺序限制为不递增。不要用互相矛盾的参数依赖校正“碰巧”获得想要结果。

单机调参会刷新需要重新解析的角色运动覆盖；联机沿既有会话隔离规则处理，不能在不同设备使用不同共享配置后期待相同结果。玩法规则变更需升级 `NetRaceProtocol.ts` 版本；本次为 v31。

回放命令和记录口径见 [数值验证](游戏数值与手感配置.zh.md#10-数值验证与后续待调)。修改运行时代码后执行项目规定的 TypeScript 检查；新增静态 UI 文案后执行 `pnpm fonts:build` 和 `pnpm fonts:check`。
