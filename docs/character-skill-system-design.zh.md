# 角色技能体系设计（每个角色专属大招 + 共用大招框架）

> 面向游泳竞速的小而美技能体系：**全员共用同一套"蓄气→释放"大招框架，但每个角色释放的专属大招效果各不相同、真实影响比赛结果**，做成可扩展的技能表。
> 代码位置（规划）：`assets/scripts/skills/`（新模块）、`assets/scripts/app/PlayerCharacterConfig.ts`、`assets/scripts/progression/RaceModifiers.ts`、`assets/scripts/swimmer/SwimmerMotor.ts`。
> 调研基准：马里奥&索尼克 2020 东京奥运游泳项目（第 8 节）、Supercell《荒野乱斗》角色区分度设计（第 9 节）。

## 当前已确认：第一版通用框架（2026-08）

本文原有的四角色专属效果保留为**第二阶段草案**。第一版先验证完整的赛内循环，不把尚未平衡的角色技能直接带进正式对局：

- **共享能量池**：蓄气仍为 0–100；海豚跃继续消耗 30 点。满 100 时可释放专属大招，释放后清空，之后继续蓄气。海豚跃与大招形成“先换位移，还是保气等满”的取舍。
- **独立操作**：大招不再复用双手长按。比赛正常水面游泳时，玩家点击右下圆形按钮释放；跳水、转身、水下、海豚跃期间按钮禁用。编辑器/桌面按 `F` 走同一入口。
- **首版效果**：全部玩家先用统一的「爆发冲刺」原型：持续 4 秒，划水加速度 ×1.15、最高速度 ×1.08。AI 保持海豚跃逻辑，但不释放该技能。
- **HUD**：用静态底盘、闪电图标、满气光环组成右下圆钮；外圈是量化、最多 30Hz 刷新的径向 Sprite 进度。满气金色呼吸，释放显示技能名和倒计时环；不做角色周身特效。
- **联机**：新增可靠帧事件 `UltimateActivate`；远端按已接受事件回放，不按预测能量二次拒绝。真人 self snapshot 追加量化剩余时长，修正丢帧与持续时间漂移；AI 不新增技能状态。
- **平衡目标**：合格且使用一次海豚跃的玩家在 100m 至少可放 1 次；200m 通常 1–2 次，500m 约 2–3 次。应记录总充能、海豚跃消耗和大招释放次数后继续调 `tuning.json`。

第二阶段再把本文第 3 节的四角色效果改为 `SkillDefinition` 表，并为角色差异、AI 策略、图标和表现逐一做平衡验证。

## 0. 设计目标与统一口径

本文档前后统一采用**一个核心设定**：

> **蓄气/释放框架全员共用，专属大招人人不同。**
> - 「如何积攒大招」：一套 `UltimateEnergyModel`（蓄气）+ 统一的"满气→释放"流程，所有角色一致，对应 `DolphinJump` 的通用底座。
> - 「大招释放后是什么效果」：每个角色各有一个专属大招，效果各不相同、真实影响名次。

- **差异化但克制**：专属大招是"手感与战术"的核心差异，不是数值碾压。效果必须能放进现有 `RaceModifierProfile` 的扩展点，数值量级落在既有 progression 的微调区间（约 ±10~20%），避免破坏平衡。
- **结局级、全区同步**：专属大招真实影响名次。因此效果随机性必须走 `SharedRNG`（绝不用 `Math.random()`），可见速度/能量态由 host 快照校正，与现有 AI `dolphin` 决策范式一致。
- **单机不变**：所有新增逻辑都以角色 digest 派生，本地玩家与远程真人走同一条 `resolveModifiersFromDigest → applyRaceModifiers*` 通道，单机依旧走原路径。
- **可扩展**：专属大招 ID 从 `characterId` 唯一派生，加角色/加大招只加一行表和一条映射，不新增联机 wire 字段。

## 1. 为什么大招 ID 从 characterId 派生（关键决策）

现状联机链路（`RaceModifiers.ts` 三层）：

```
resolveLocalModifierDigest()  →  { characterId, level }        // 本地存档
编码成 "MOD|<pos>|<characterId>,<level>"  →  广播进房间每个客户端
decodeModifierDigest → resolveModifiersFromDigest(digest)      // 共享配置+纯函数
applyRaceModifiersToMotor / ToSwimmer                          // 应用到本机和远程
```

`RaceModifierDigest` 现在只有 `characterId` + `level`。**每个角色天然绑定一个专属大招**，所以大招 ID 可以由 `characterId` 查表唯一得到，**不需要在 digest 里新增字段、不需要改 codec**。这样：

- 联机零改动：远程每个客户端的 `resolveModifiersFromDigest` 用共享的 `SKILL_DEFINITIONS` 表，从同一个 `characterId` 解析出完全一致的专属大招 profile。
- 未来的"可装备多个大招/自由选择"再在 digest 加 `skillId` 字段即可，一次性、向后兼容。

## 2. 数据模型

### 2.1 专属大招定义表（新增 `assets/scripts/skills/SkillDefinition.ts`）

```ts
export type SkillKind =
    | 'ultimate'   // 专属大招：消耗蓄气释放，效果各不相同（本文档核心）
    | 'passive';   // 可选被动：全程生效的小维度（借鉴荒野乱斗妙具/星辉，非必需）

export type SkillEffectKind =
    | 'speedCap'        // 最高速度乘数
    | 'strokeAccel'     // 划水加速度乘数
    | 'energyCost'      // 大招消耗减免
    | 'energyGain'      // 蓄气速率乘数
    | 'turnKick'        // 转身后爆发/保持速度
    | 'sprintBoost'     // 冲刺阶段加速
    | 'comboBonus'      // 连击/蓄气奖励
    | 'diveBoost';      // 入水/起跳

export interface SkillDefinition {
    id: string;                 // 稳定英文键，如 'skill.muscleman.slugger'
    name: string;               // 中文名（替换现有 skillName）
    description: string;        // 中文说明（替换现有 skillDescription）
    kind: SkillKind;
    // 专属大招：满气后释放的主动效果（kind='ultimate' 时必填）
    ultimateCost: number;       // 该大招的蓄气消耗（可与 `dolphinCost` 差异化）
    // 效果作用域：每个大招可有 1 个主效果 + 若干次效果，全部为数值
    effects: { kind: SkillEffectKind; value: number }[];
    // 是否影响比赛结局（决定是否必须走 SharedRNG / host 校正）
    outcomeAffecting: boolean;
}
```

### 2.2 角色到专属大招的映射（skillId 由 characterId 派生）

```ts
export function skillForCharacterId(id: PlayerCharacterId): SkillDefinition | null {
    return PLAYER_SKILL_MAP[id] ?? null;
}
```

`PLAYER_SKILL_MAP` 是 `Record<PlayerCharacterId, SkillDefinition>`，**一个角色一个专属大招**。

## 3. 四个角色的专属大招设计（详细规格）

基于现有属性定位（铁臂狂鲨=爆发、灵波飞鱼=技术、破浪新星=均衡、深海潜将=耐力），**每个专属大招都从角色定位延伸**（借鉴荒野乱斗"大招由定位长出"），而非为"人人不同"堆特效。

> 统一约定：
> - **蓄气框架全员共用**（`UltimateEnergyModel`，角色只差异化 `ultimateCost` 消耗点数与 `energyGain` 蓄气倍率），延续第 0 节口径。
> - **释放效果**：每个大招把 `effects` 映射到现有平衡轴（`PlayerBalanceOverrides` / `UltimateEnergyModel` / `SwimmerMotor` hook），不新增溢出系统。
> - 所有数值进 `tuning.json`，键名用稳定英文（见各区 [tuning keys]），可调参、可覆盖默认。
> - `outcomeAffecting=true` 一律影响名次；不含概率的纯乘数天然确定，含概率的走 `SharedRNG`。

### 3.1 总览表

| 角色 | 定位 | 专属大招 | 主动类型 | ultimateCost | 释放效果（核心） | 触发时机 | outcomeAffecting |
|---|---|---|---|---|---|---|---|
| 铁臂狂鲨 | 爆发 | **破浪重击** | 冲刺强化 | 40（较贵） | 冲刺阶段划水加速度 ×1.12 + 短暂最高速 +6% | 冲刺段（85% 后）/ 落后追赶 | 是 |
| 灵波飞鱼 | 技术 | **水感律动** | 节奏/连击 | 30（默认） | PERFECT 甜区窗口 ×1.10 + 连击蓄气翻倍 | 开局稳节奏 / 连击中断后 | 是 |
| 破浪新星 | 均衡 | **流线穿梭** | 速度/转身 | 35（中） | 最高速度 ×1.05 + 转身后保持速度更好 | 转身后 / 中程追赶 | 是 |
| 深海潜将 | 耐力 | **深潜续航** | 节能/防御 | 25（较便宜） | 大招消耗 -15% + 蓄气 ×1.08 + 体能消耗更慢 | 全程靠前段（越早越赚） | 是 |

> 说明：`ultimateCost` 差异化借鉴荒野乱斗"大招条长度不同"——强效果大招（破浪重击）消耗更高，节能型（深潜续航）消耗更低。蓄气本身仍是共用框架，只是"释放成本"角色化。

### 3.2 铁臂狂鲨「破浪重击」—— 冲刺强化型

- **主动类型**：冲刺强化（对标荒野乱斗 Bull 突进/Colt 强化普攻——把"爆发定位"放大成一次冲刺期的爆发）。
- **释放效果分解**：
  - `sprintBoost`：冲刺阶段（进入 SPRINT 后）划水加速度 ×1.12，持续 4s。
  - `speedCap`：持续期间最高速度临时 ×1.06。
  - 加成随 `burst` 派生（爆发力越高，×1.12~×1.16）。
- **充能/消耗**：`ultimateCost=40`（全场最贵，换取最强的胜负手）。
- **触发时机**：冲刺段（85% 后）或落后需追赶时——选"关门瞬间"收益最大。
- **联机同步**：纯乘数，确定性，无随机分支 → 无需 SharedRNG；速度/能量态由 host `NetRaceSnapshot` 权威校正。
- **tuning keys**：`skill.muscleman.sprintBoostAccelScale`(=1.12)、`skill.muscleman.sprintBoostSpeedCapScale`(=1.06)、`skill.muscleman.sprintBoostDurationSec`(=4)、`skill.muscleman.ultimateCost`(=40)。
- **风险**：冲刺期加速是最直接的胜负手，量级需最小化（±10% 内）并真机验证，避免"一局定生死"。

### 3.3 灵波飞鱼「水感律动」—— 节奏/连击强化型

- **主动类型**：节奏/连击强化（对标荒野乱斗 Max 群体增益——把"技术定位"放大成对判定/连击的掌控）。
- **释放效果分解**：
  - `comboBonus`：持续期间连击蓄气翻倍（`comboBonus` ×2，约 +2 点/每 5 连击）。
  - `strokeQuality`：期间 PERFECT 甜区窗口 ×1.10（走 `perfectComboMaxOvercap` 派生）。
- **充能/消耗**：`ultimateCost=30`（默认，与现海豚跃一致）。
- **触发时机**：开局稳住节奏，或连击中断后重新建立连击——收益在"能持续保持 PERFECT"的玩家手里最高。
- **联机同步**：纯乘数，确定性 → 无需 SharedRNG；能量态由 host 校正。
- **tuning keys**：`skill.women2.comboBonusMultiplier`(=2)、`skill.women2.sweetZoneScale`(=1.10)、`skill.women2.durationSec`(=5)、`skill.women2.ultimateCost`(=30)。
- **风险**：甜区加宽若过大≈降低难度（等同于变相 fpp 加成），需控制在 ±10% 内；对高手正向收益高、对新手收益低，注意滚雪球。

### 3.4 破浪新星「流线穿梭」—— 速度/转身型

- **主动类型**：速度/转身强化（对标荒野乱斗 Shelly 强化普攻——把"均衡定位"放大成通用速度与转身效率）。
- **释放效果分解**：
  - `speedCap`：期间最高速度 ×1.05。
  - `turnKick`：期间转身后保持速度更好（`turnKick` 乘数，弥补转身减速）。
- **充能/消耗**：`ultimateCost=35`（中）。
- **触发时机**：转身后 / 中程追赶——把"每次折返的损耗"压下去，适合长距离（100/200m）。
- **联机同步**：纯乘数，确定性 → 无需 SharedRNG；速度/位置态由 host 校正。
- **tuning keys**：`skill.lowpolyhuman2.speedCapScale`(=1.05)、`skill.lowpolyhuman2.turnKickScale`、`skill.lowpolyhuman2.durationSec`(=4)、`skill.lowpolyhuman2.ultimateCost`(=35)。
- **风险**：`turnKick` 需要新增 `SwimmerMotor` hook（转身阶段乘数），是最"新"的机制点，需最小侵入实现并在联机验证转身态一致性。

### 3.5 深海潜将「深潜续航」—— 节能/防御型

- **主动类型**：节能/续航（对标荒野乱斗 Support/防御定位——把"耐力定位"放大成资源效率）。
- **释放效果分解**：
  - `energyCost`：期间大招消耗 -15%（`spendDolphin` 处乘系数）。
  - `energyGain`：期间蓄气速率 ×1.08（`setGainMultiplier`）。
  - `stamina`：期间体能（`energyTotal`）消耗更慢（condition 消耗乘数）。
- **充能/消耗**：`ultimateCost=25`（全场最便宜，鼓励频繁释放）。
- **触发时机**：全程靠前段释放（越早越赚），尤其长距离/高难度（体能压力大时）。
- **联机同步**：纯乘数，确定性 → 无需 SharedRNG；能量/体能态由 host 校正。
- **tuning keys**：`skill.diver.energyCostScale`(=0.85)、`skill.diver.energyGainScale`(=1.08)、`skill.diver.staminaConsumptionScale`、`skill.diver.durationSec`(=6)、`skill.diver.ultimateCost`(=25)。
- **风险**：节能虽不直接提速，但变相延长时间优势，长距离易滚雪球；体能耗减需与现有 `PlayerConditionModel` 消耗逻辑对齐，避免叠乘爆炸。

### 3.6 可选被动（正交小维度，非核心）

每个角色可再挂 1 个可选被动（借鉴荒野乱斗妙具/星辉的正交分层），不影响结局判定的核心，暂缓实现：

| 角色 | 可选被动 | 效果草拟 |
|---|---|---|
| 铁臂狂鲨 | 划水加速度 + | 全程划水加速度 ×1.04 |
| 灵波飞鱼 | 连击蓄气奖励 +20% | `comboBonus` +20% |
| 破浪新星 | 转身后保持速度 | `turnKick` 常驻小幅 |
| 深海潜将 | 大招消耗 -15% | `energyCost` 常驻 -10% |

> 注意：以上均为**数值草拟**。量级进 `tuning.json` 而非硬编码，需在真机/模型调试面板实测，避免破坏平衡。每个效果都应在 `PlayerBalanceOverrides` 或 `SkillRuntime` 里可调。
## 4. 运行时接入（最小侵入）

新增 `assets/scripts/skills/SkillRuntime.ts`（无 Cocos 依赖的纯数值层，类似 `UltimateEnergyModel`），由 `Swimmer` 持有，效果通过现有 hook 注入：

- **蓄气/释放**：所有角色共用 `UltimateEnergyModel`（被动蓄气 + 划水评级/连击/被撞加气），`ultimateCost` 角色化（对应荒野乱斗"大招条长度差异化"）。
- **释放效果**：`speedCap / strokeAccel / turnKick / sprintBoost / diveBoost` → 转换成对 `SwimmerMotor` 的乘数，在 `RaceModifiers.resolveModifiersFromDigest` 里并入 `PlayerBalanceOverrides`（扩展该类型加字段），或暴露 `motor.setSkillMultipier(kind, value)`。
- **energyCost / energyGain / comboBonus** → 注入 `UltimateEnergyModel`（`setGainMultiplier` 已有；energyCost 在 `spendDolphin` 处乘系数）。
- **联机判定**：`outcomeAffecting=true` 的技能效果，任何随机/概率分支必须抽 `SharedRNG`；不引入概率的纯乘数天然确定，无需额外处理。

### 4.1 digest → profile 扩展

```ts
export interface RaceModifierProfile {
    balance: PlayerBalanceOverrides | null;
    skill: SkillDefinition | null;   // 新增：由 characterId 派生
}
```

`resolveModifiersFromDigest` 里加 `skill: skillForCharacterId(characterId)`。`applyRaceModifiersToSwimmer` 里 `swimmer.setSkill(skill)`。

### 4.2 PlayerCharacterConfig 改造

把现有 `skillName` / `skillDescription` 两个字段**替换为** `skillId: string`（或保留为冗余展示字段，由 `SkillDefinition` 提供内容）。选人面板 `PrepareRaceFlow.ts:370-377` 改为从 `skillForCharacterId` 读 name/description，避免文案散落。

## 5. 联机同步与确定性（结局级）

- **纯乘数大招**（最高速度、加速度、能量消耗）：所有客户端从共享 digest → 共享表解析出**相同数值**，天然同步，无需额外同步。
- **带随机/概率的大招**：任何会影响名次的随机分支抽 `SharedRNG`（与 `AISwimmerController` 的 dolphin 决策一致），绝不用 `Math.random()`。
- **可见速度/能量态校正**：大招改变的速度/能量最终由 host 的 `NetRaceSnapshot`（`distCm/latMm/speed/energy/heading`）校正，跨引擎浮点漂移被 host 权威值兜底。参照 `NetSwimmerLook` 的 `applyNetPoseSpeed` 模式——大招不作为独立来源，而是叠加在"host 校正的权威态"上。
- **单机不变**：专属大招只作用于"当前角色 moteur"，AI 仍读原始全局常量（`applyRaceModifiersToMotor` 只影响玩家/远程真人，AI 走 `CompetitorManager.applyProfile`），与现有 progression 行为一致。

## 6. 实施清单（按依赖顺序）

1. 新建 `assets/scripts/skills/SkillDefinition.ts`（表 + `skillForCharacterId`）。
2. 新建 `assets/scripts/skills/SkillRuntime.ts`（纯数值旁路/乘数聚合）。
3. 扩展 `PlayerBalanceOverrides` + `resolvePlayerBalance`，把专属大招效果并入 balance（或新增 `motor.setSkillMultipier`）。
4. 扩展 `RaceModifierProfile` + `resolveModifiersFromDigest`（加 `skill` 字段）。
5. `Swimmer` 增加 `setSkill`，把专属大招接进 motor / ultimate / swimmer phases。
6. 改造 `PlayerCharacterConfig.ts`（`skillId`）与 `PrepareRaceFlow.ts`（读表渲染）。
7. 把专属大招数值暴露到 `tuning.json` / 模型调试面板，实测平衡。
8. 跑类型检查：`npx.cmd --yes --package typescript@5.4.5 tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck`。

## 7. 风险与边界

- **别做成"想一出是一出"**：专属大招效果必须映射到既有的平衡轴（速度/加速度/能量/甜区/转身），不新增溢出的新系统。每个大招都要回到 `PlayerBalanceOverrides` 的既有字段或一个明确的 hook。
- **共用框架 vs 专属效果要分清**：蓄气/释放流程全员共用，专属的是"释放后的效果"——不要把蓄气机制也做成每个角色不同，否则会碎片化联机逻辑。
- **数值不进硬编码**：所有大招数值进 `tuning.json`，可调参、可覆盖默认。
- **联机门控**：大招对结果的影响要可被 host 快照收敛；若某大招引入"局部不可预测"状态，必须设计成 host 权威或纯视觉。
- **不破坏现有单机**：任何分支都走 digest 派生，单机路径零行为变化。

## 8. 参考：马里奥&索尼克 2020 东京奥运游泳项目

调查结论（基于 mariowiki）：

- **没有"每个角色一个独立专属大招"**。游泳是 100m 自由泳：玩家高速做划水动作填 **Super Gauge（超级量表）**，但不能快到 burn out（烧干）；**转身后**触发 **Super Dash（超级冲刺）**。
- 角色差异来自**类型 + 事件特定优势**：分 All-Around / Power / Speed / Technique 四型。游泳里：Power 型「擅长 Super Move」、Speed 型「游得快」、Technique 型「擅长转身」。
- 每个角色划水**风格/操作输入不同**，但共用同一套机制。

**借鉴取舍**：马里奥&索尼克给的是"**通用大招机制 + 角色类型偏斜**"，没有"每人一个独立大招"的范本。它确认了"全员共用大招框架"的可行性（对应我们的 `UltimateEnergyModel` + `DolphinJump` 底座），但**角色区分度要靠我们自己补**——这正是本文档第 3 节"每个角色专属大招"要做的。

### 8.1 扩展调研：系列里"角色专属大招"到底存不存在

针对"每个角色有一个专属大招、各不相同、且影响结果"这个想法，进一步核实了马里奥&索尼克整条系列（Wii / DS / 伦敦2012 / 里约2016 / 东京2020）：

- **游泳（100m Freestyle）在系列每一作都没有"每个角色专属大招"**。它始终是通用「Super Gauge → 转身后 Super Dash」，角色差异靠类型 + 事件特定优势 + 划水风格/操作输入差异。
- **Dream Events（梦之项目）**是系列里最接近"花活大招"的地方，但它们是**非奥运规则的娱乐项目**（Dream Racing / Dream Karate / Dream Shooting 等），靠 IP 道具、障碍、敌人制造差异，**不是"每个角色各有一个大招"**，且**东京2020的 Dream Events 不包含游泳/水上项目**。里约2016 甚至没有 Dream Events（换成 Duel / Plus Events）。
- 结论：**马里奥&索尼克"游泳 + 每个角色专属大招"这个组合不存在标准答案**。它给的是"通用机制 + 角色类型偏斜"这套成熟范式，而不是每人一个独立大招。

**对本项目的启示**：
- 想完全照抄"每人一个专属大招且各不相同"没有现成范本，需要自己设计（这正是本文档在做的事）。
- 现有 `UltimateEnergyModel` + `DolphinJump` 已经实现了"通用大招框架"，可复用作蓄气/释放底座。
- 因此本文档采用「**通用大招框架 + 每个角色专属的释放效果**」——蓄气→释放流程全员一致，但每个角色释放的专属大招效果不同（例：铁臂狂鲨=冲刺型大招、灵波飞鱼=连击蓄气型、破浪新星=均衡速度型、深海潜将=节能型）。既有"每人不同"，又保持统一框架可扩展、可同步。

## 9. 参考：Supercell《荒野乱斗》的机制深挖（每角色独立大招的成熟范本）

Supercell 的《荒野乱斗》(Brawl Stars) 是"每个角色独立大招 + 高区分度"的典型。以下基于荒野乱斗英文 wiki（brawlstars.fandom.com）与 Wikipedia 的逐条核实。

### 9.1 机制事实（逐条核实）

**Super（大招）核心机制：**
- **每个 Brawler 都有 1 个完全独立的 Super（超级技能/大招）**，效果各不相同，是角色差异的核心载体。
- **充能方式**：Super 主要靠**命中敌方 Brawler 充能**（不是靠时间/被动）。充能条**不会因角色死亡丢失**。
- **充能条分段设计**：血量条下方有"攻击蓄力"条（多数角色最多 3 发普攻，随时间自动回复），大招条是独立的黄色条，满后可用。

**分层能力体系（每个 Brawler 专属）：**
- 普攻（Main Attack）：弹道/射程/伤害/装弹速度/攻击方式各不相同。
- **Super（大招）**：满条后释放，效果因角色而异。
- **Gadget（妙具）**：赛内主动小技能，按按钮触发，有冷却，无限次。
- **Star Power（星辉）**：被动，无需按钮，无限生效。
- **Hypercharge（超充能）**：赛内主动终极强化，持续 5 秒，期间获得额外大招/加速/增伤/护盾。
- **Trait（特性）**：部分角色的被动特性，全等级生效。
- 以上除 Gears（齿轮，通用）外，**全部是每个 Brawler 专属**。

**角色定位矩阵：** Brawler 按攻击/玩法分 Tank / Sharpshooter / Support / Assassin / Artillery / Damage Dealer 等，普攻射程、伤害、弹道、装弹速度、攻击方式各不相同。

### 9.2 代表性角色大招实证（证明"机制各不相同"）

从 wiki 逐个抓取的大招（Super）原文摘要：

| 角色 | 定位 | Super 名称 | 大招效果（原文摘要） |
|---|---|---|---|
| Shelly | 近战散弹 | Super Shell | 放射更大、高伤、穿透、摧毁障碍、击退敌人的弹团；越近伤害越高 |
| Bull | 坦克 | Bulldozer | 冲撞（突进型大招），配合其近距离高伤定位 |
| Colt | 射手 | Bullet Storm | 射出更长射程、穿透、可摧毁障碍的十二发强化弹幕 |
| Mortis | 刺客 | Life Blood | 召唤吸血蝙蝠群，命中敌人造成伤害并给自身回血 |
| Nita | 召唤 | Overbearing | 召唤熊 Bruce 追击攻击敌人（召唤物型大招） |
| Max | 辅助 | Let's Go! | 制造 4 格范围光环，短暂提升自身与队友移动速度（群体增益型） |

六个角色大招从"强化普攻"（Shelly/Colt）、"突进"（Bull）、"召唤物"（Nita）、"吸血"（Mortis）、"群体增益"（Max）覆盖了完全不同的机制类型——**确凿证明"每角色独立大招"是真实且差异极大的**。

### 9.3 它对"角色区分度"的核心手法（可借鉴点）

1. **普攻 + Super 一体设计**：Super 不是凭空加的花活，而是**从普攻的攻击方式/定位延伸出来**（如近战坦克 Bull 的大招是突进，狙击手的 Super 类似强化狙击）。定位决定大招，大招强化定位。
2. **大招充能来自"有效操作"**：命中敌人才充能，奖励主动进攻而非被动挂机；充能条长度因角色而异（强效果需要更多充能）。
3. **充能条死亡不丢失**：降低挫败感，鼓励敢打。
4. **多层但正交**：普攻 / Super / 妙具 / 星辉 / 超充能各管一个维度，层与层不重叠，玩家一眼看出"这角色强在哪"。
5. **数值克制 + 定位克制**：区分度不仅是数值，更是克制关系（远程克近战、刺客克脆皮），每个角色有不可替代的 niche。
6. **易上手、难精通**：基础机制人人一样（普攻攒大招→放），但每角色的攒条速度、释放时机、配合妙具的打法不同，形成深度。

### 9.4 对本项目（游泳竞速）的映射

| 荒野乱斗 | 本项目落点 |
|---|---|
| 每个 Brawler 独立 Super | **每个角色一个专属大招**（效果不同、影响结果，本文档第 3 节） |
| 普攻命中充能大招条 | 现有 `UltimateEnergyModel`（划水评级/连击/被撞蓄气）——**全员共用** |
| Super 由普攻定位延伸 | 专属大招由角色属性定位延伸（爆发→冲刺型、技术→连击型、均衡→速度型、耐力→节能型） |
| 大招条长度差异化 | 不同角色 `ultimateCost` 不同（`dolphinCost` 可角色化） |
| 妙具/星辉=正交小维度 | 每个角色可再挂 1 个被动（可选，非必需） |
| 克制关系 | 游泳里可做"战术克制"（如爆发型克稳定型，但耐力型克爆发型） |

**关键取舍**：荒野乱斗给的最有价值的一点是——**大招不是孤立的"炫技"，而是角色定位的自然延伸**。建议本项目每个角色的专属大招都从它已有的属性定位推导，而不是为"人人不同"而堆砌无关特效。这样既满足"每个角色大招不同、影响结果"，又保持可扩展、可联机同步。

## 10. 参考：其他"每角色独立大招"游戏 + 水上题材调研

### 10.1 其他知名"每角色独立大招"游戏（非水上，但机制成熟）

| 游戏 | 类型 | 独立大招机制 | 对本项目可借鉴点 |
|---|---|---|---|
| **Overwatch / Overwatch 2** | 英雄射击 | 每个英雄有独立终极技能（大招），蓄能制，效果迥异 | "大招是定位的放大器"；大招蓄能靠有效输出/治疗 |
| **Apex Legends** | 英雄射击 / 吃鸡 | 每个传奇有独立战术技能 + 终极技能 | 大招与普攻/战术技能配合；大招冷却与充能结合 |
| **Super Smash Bros.** | 大乱斗 | 每个角色独立技能组（含侧/上/下必杀） | 角色差异来自"技能组 + 数值"而非单一数值 |
| **MOBA（英雄联盟/王者荣耀/荒野乱斗前身）** | MOBA | 每个英雄 4 技能 + 独立大招，定位分工明确 | 大招是连招终点；定位（坦克/射手/法师/辅助）决定大招 |
| **Sonic Forces: Speed Battle** | 跑酷竞速（手游） | 每个角色有专属能力/道具倾向 | **竞速 + 角色技能**结合，最贴近本项目"游泳竞速" |
| **马里奥&索尼克系列** | 奥运体育 | 无每角色独立大招，通用机制+类型偏斜（见第 8 节） | 反例：确认"通用框架"可行但角色差异弱 |

### 10.2 水上题材调研结论（重点）

针对"水上/游泳题材 + 每角色独立大招"专门检索了维基百科与游戏资料：

- **传统水上竞速游戏（Wave Race 64、Hydro Thunder、Riptide GP 系列、Jet Ski 类）**：几乎都是**无角色技能**的纯竞速，角色/赛艇只有属性差异（速度/操控/转弯），**没有"每角色独立大招"**。
- **水上/海洋题材的"大乱斗/英雄"类游戏**：主流（荒野乱斗等）以陆地战斗为主，**几乎不存在"水上大乱斗 + 每角色独立大招"的知名范本**。荒野乱斗本身以陆地为主。
- 结论：**"水上题材 + 每角色独立大招"是一个尚无成熟先例的细分方向**，没有现成范本可抄，需要自己设计（这正是本项目正在做的事）。

### 10.3 对水上题材落地的建议

既然没有现成水上范本，最接近的参考是"**竞速/跑酷 + 角色技能**"（Sonic Forces: Speed Battle、马里奥赛车类）与"**大乱斗独立大招**"（荒野乱斗）。建议把两者结合：

- **框架**：借鉴荒野乱斗——普攻（划水）充能大招条，每个角色专属大招。
- **题材**：借鉴竞速——大招释放时机（冲刺/转身/落后追赶）是策略点，而非纯战斗。
- **差异化**：每个角色专属大招从它的游泳属性定位延伸（爆发/技术/均衡/耐力），形成"我的角色强在冲刺，你的强在连击"的可辨识差异。
