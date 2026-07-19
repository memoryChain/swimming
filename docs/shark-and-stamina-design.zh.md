# 鲨鱼系统与体能博弈设计

> 定位：**在 IO 互撞竞速基础上，加入随机威胁与体能策略层**。把游戏从"谁按得标准谁赢"变成"谁分配体能好、谁应对鲨鱼策略好谁赢"。
> 状态：**设计阶段，待实现**。作者视角：策划。

## 1. 背景与问题

### 1.1 当前问题

当前游戏核心循环是节奏划水竞速：左右手交替划水，按得越标准越快，单手划多了身体蛇形偏移。加了碰撞互撞后比纯竞速有趣了，但仍然存在一个根本问题：

**熟练玩家完美碾压新玩家，没有随机性。**

划水节奏好的人永远赢，划水差的人永远输。硬核玩家玩几局摸透节奏就稳定拿第一，休闲玩家被碾压几次就不玩了。缺少翻盘机会和随机性，泛用户留存差。

### 1.2 解决方向

引入两个机制稀释纯操作的胜负权重：

- **鲨鱼系统**：随机移动的威胁源，制造每局不同的局面，迫使玩家做策略应对而非纯比手速。
- **体能博弈**：冲刺大幅消耗体能，正常节奏消耗正常，不划水时缓慢恢复。体能管理成为独立于操作的策略维度。

## 2. 鲨鱼系统

### 2.1 整体设计

一条鲨鱼在泳池里活动，有四个状态交替切换：

```
游荡 -> 饥饿预警 -> 饥饿追击 -> (吃到人?) 
  是: -> 游荡 (淘汰计数+1, 若达上限则 -> 吃饱)
  否: -> 游荡 (继续下一轮)
```

| 状态 | 行为 | 时长 | 玩家感受 |
|------|------|------|---------|
| 游荡 (WANDER) | 缓慢随机移动，有碰撞体积挡路，不咬人 | 15-20秒 | 可以利用鲨鱼当移动路障挡对手路线 |
| 饥饿预警 (WARNING) | 鲨鱼眼睛变红，锁定线指向最近的人 | 2-3秒 | "要来了"的紧张感，被锁定的人准备逃命 |
| 饥饿追击 (HUNT) | 追击当前最近的人，追到后拖走淘汰 | 5-8秒 | 被追的人逃命，其他人看热闹或趁机超车 |
| 吃饱 (SATIATED) | 累计淘汰达到上限（3人）后，沉底不动，无碰撞 | 到比赛结束 | 安全了，最后冲刺 |

### 2.2 核心规则

**鲨鱼追"当前最近的人"，可以逃脱。**

- 鲨鱼锁定离它最近的选手追击。
- 如果被追的人游得比别人快、拉开距离，鲨鱼会切换目标去追新的最近的人。
- 直到成功咬到一个人并拖走淘汰，鲨鱼才回到游荡阶段。
- 每次饥饿阶段最多淘汰 1 人。

**淘汰上限 3 人。** 鲨鱼吃满 3 个人后进入吃饱状态，沉到水底不动，碰撞关闭，弹出文案"鲨鱼吃饱了，请放心游泳"。之后剩余 5 人纯竞速到终点。

### 2.3 鲨鱼与操作系统的联动

鲨鱼的位置不同，玩家的应对策略也不同：

- **鲨鱼在后面追你**：加速逃跑，额外消耗体能。被迫花钱保命，后面可能体能不足。
- **鲨鱼在前面挡路**：减速等它走，或者绕路。减速意味着暂时落后，但省了体能。
- **鲨鱼在侧面**：单手划水调方向绕开。单手划水效率低（蛇形转向系统已实现），速度下降但不绕太远。

### 2.4 鲨鱼与碰撞系统的联动

- 游荡阶段，鲨鱼是移动路障，可以故意把对手挤向鲨鱼。
- 饥饿阶段，鲨鱼追"最近的人"，你把别人推近鲨鱼，鲨鱼可能切换目标追他。碰撞从"互相挤"升级为"把人推向危险"。

### 2.5 假安全转折（可选包装层）

比赛开始时 UI 显示"安全水域，祝您游泳愉快"，过 20 秒弹出"检测到异常生物"警告，鲨鱼出现。这个"从安全到危险"的转折点让前半段放松互撞、后半段紧张逃亡，反差产生戏剧性。与搞笑风定位契合。

## 3. 体能博弈

### 3.1 核心原则

**正常节奏游是性价比最高的，冲刺是亏的。**

| 状态 | 速度倍率 | 体能消耗倍率 |
|------|---------|------------|
| 正常节奏划水（OPTIMAL 心率区） | 1.0 | 1.0（基准） |
| 快速冲刺划水（HIGH_PRESSURE / OVERLOAD） | 1.2 | 1.5 - 2.5 |
| 不划水（漂浮） | 0（减速滑行） | 缓慢恢复 |

长期正常节奏游比较划算。冲刺相当于额外消耗体能换取少量移速提升。

### 3.2 体能耗尽后

速度大幅下降（通过划水质量和效率惩罚间接体现），但不会完全停摆。玩家可以停止划水让体能恢复到一定阈值后重新正常游。

### 3.3 体能恢复

**不划水时缓慢恢复。** 恢复速率很慢，全程不划水一局（约 80 秒）大约恢复总量的 1/4 到 1/3。主动停顿恢复有收益但代价大 -- 停 5 秒恢复约 15 点，但别人游出去十几米了。

正常节奏划水时不恢复也不额外消耗，保持平衡。只有"不划水"才恢复。

### 3.4 冲刺触发

自动触发。划水频率超过某个阈值就自动进入冲刺状态，自动多消耗体能。划水频率超过阈值时，体能条边缘闪烁，提示玩家"你在消耗额外体能"。

### 3.5 体能总量

一局比赛（70-90 秒）的体能总量，够冲刺 3-4 次（每次 3-5 秒）。全程冲刺大约撑 30 秒就空了。正常节奏游完整局体能还剩 30-40%。

### 3.6 体能把三个系统串起来

体能管理不只影响速度，还串联了碰撞和鲨鱼两个系统：

- 体能充足时可以主动撞人、把对手推向鲨鱼（碰撞消耗体能）。
- 体能不足时要避开碰撞，因为撞人也要花体能。
- 鲨鱼饥饿时，体能充足的人可以加速逃跑，体能不足的人跑不动容易被追上。

划水节奏、碰撞互撞、鲨鱼逃避三个系统通过"体能"这个资源串联成一个完整的策略闭环。

## 4. 赛制总览

```
8 选手开始，100-150m 赛道

  0-15秒：正常竞速 + 互撞，鲨鱼游荡挡路
  ~15秒：鲨鱼第 1 次饥饿
    -> 预警 2-3 秒 -> 追最近的人 -> 淘汰 1 人（剩 7 人）-> 回到游荡
  ~35秒：鲨鱼第 2 次饥饿
    -> 淘汰 1 人（剩 6 人）-> 回到游荡
  ~55秒：鲨鱼第 3 次饥饿
    -> 淘汰 1 人（剩 5 人）-> 吃饱，沉底不动
  ~55秒-终点：剩余 5 人纯竞速冲刺到终点 -> 冠军

  被鲨鱼淘汰的人随时开下一局，不用等比赛结束
```

总时长约 70-90 秒。3 次鲨鱼追人是 3 个高潮时刻，最后 5 人冲刺是终局。

## 5. 详细实现方案

### 5.1 鲨鱼状态机

```
SharkState 枚举:
  WANDER     - 游荡：随机移动，碰撞挡路，不咬人
  WARNING    - 饥饿预警：锁定最近目标，眼睛变红，锁定线显示
  HUNT       - 饥饿追击：追击目标，接触则淘汰
  SATIATED   - 吃饱：沉底不动，碰撞关闭
```

状态转换时序：

```
WANDER (15-20s) 
  -> WARNING (2-3s, 锁定最近的人) 
  -> HUNT (5-8s, 追击)
    -> 咬到人: 淘汰该选手, 淘汰计数+1
      -> 计数 >= 3: SATIATED (到比赛结束)
      -> 计数 < 3:  WANDER (下一轮)
    -> 追击超时未咬到: WANDER (本次不淘汰)
```

### 5.2 鲨鱼实体设计

新建文件 `assets/scripts/entity/SharkEntity.ts`

**数据结构：**

```typescript
export enum SharkState {
    WANDER = 'wander',
    WARNING = 'warning',
    HUNT = 'hunt',
    SATIATED = 'satiated',
}

// 鲨鱼调参常量（集中配置，方便调参）
export const SHARK_TUNING = {
    // 碰撞半径（比选手的 0.9 大约 2-3 倍）
    collisionRadius: 2.0,
    // 游荡阶段移动速度（比选手慢，约 maxSpeed 的 30-40%）
    wanderSpeed: 1.2,
    // 游荡方向切换间隔（秒）
    wanderDirectionChangeInterval: 3.0,
    // 饥饿预警时长（秒）
    warningDuration: 2.5,
    // 追击速度（比选手 maxSpeed 略快，但不至于必死）
    huntSpeed: 4.5,
    // 追击超时（秒，超时未咬到则放弃）
    huntTimeout: 8.0,
    // 追击时目标切换检测间隔（秒）
    huntRetargetInterval: 0.5,
    // 淘汰上限
    maxEliminations: 3,
    // 游荡阶段间隔范围（秒，第一次到第二次之间的游荡时长）
    wanderDurationMin: 15.0,
    wanderDurationMax: 20.0,
    // 吃饱后沉底 Y 坐标偏移
    satiatedSinkOffset: -1.5,
};
```

**鲨鱼节点结构：**

```
SharkNode (Node)
  ├── SharkBody (MeshRenderer / 程序化几何体)
  ├── SharkEyes (Node, 控制眼睛颜色变化)
  └── LockOnIndicator (Node, 锁定线显示)
```

鲨鱼模型先用程序化几何体（椭圆体 body + 三角形 fin），低面数，单色材质。后续替换为正式模型。

### 5.3 鲨鱼 AI 逻辑

新建文件 `assets/scripts/entity/SharkController.ts`

**游荡阶段 (WANDER)：**

```typescript
// 游荡阶段：在泳池范围内随机方向移动
updateWander(dt: number) {
    this._wanderTimer += dt;
    
    // 每隔 wanderDirectionChangeInterval 秒切换一个随机方向
    if (this._wanderTimer >= SHARK_TUNING.wanderDirectionChangeInterval) {
        this._wanderTimer = 0;
        this._wanderDirection = randomDirectionInPoolBounds();
    }
    
    // 按当前方向移动，碰到泳池边界则反弹
    moveShark(this._wanderDirection * SHARK_TUNING.wanderSpeed * dt);
    clampToPoolBounds();
    
    // 游荡时间到了，进入饥饿预警
    this._wanderElapsed += dt;
    if (this._wanderElapsed >= randomWanderDuration()) {
        this.enterWarning();
    }
}
```

游荡方向不是完全随机的，而是偏向沿泳池长轴（X 轴）移动，偶尔有横向（Z 轴）偏移。这样鲨鱼主要在泳道方向上移动，更自然地挡路。

**饥饿预警阶段 (WARNING)：**

```typescript
// 预警阶段：锁定最近的人，显示锁定线
enterWarning() {
    this._state = SharkState.WARNING;
    this._warningTimer = 0;
    this._target = this.findNearestSwimmer();
    // 视觉：眼睛变红，锁定线从鲨鱼指向目标
    this.setEyesRed(true);
    this.showLockOnIndicator(this._target);
    // 音效：低沉警告音
    this.playWarningSound();
}

updateWarning(dt: number) {
    this._warningTimer += dt;
    // 持续更新锁定目标（最近的人可能变了）
    this._target = this.findNearestSwimmer();
    this.updateLockOnIndicator(this._target);
    
    if (this._warningTimer >= SHARK_TUNING.warningDuration) {
        this.enterHunt();
    }
}
```

**饥饿追击阶段 (HUNT)：**

```typescript
// 追击阶段：追击当前最近的人，可以切换目标
enterHunt() {
    this._state = SharkState.HUNT;
    this._huntTimer = 0;
    this._retargetTimer = 0;
}

updateHunt(dt: number) {
    this._huntTimer += dt;
    this._retargetTimer += dt;
    
    // 每 huntRetargetInterval 秒重新检测最近的人
    // 这就是"可以逃脱"的实现：如果你比别人快，拉开距离后鲨鱼会切换目标
    if (this._retargetTimer >= SHARK_TUNING.huntRetargetInterval) {
        this._retargetTimer = 0;
        this._target = this.findNearestSwimmer();
    }
    
    // 朝目标移动
    if (this._target) {
        const direction = directionTo(this._target.node.position);
        moveShark(direction * SHARK_TUNING.huntSpeed * dt);
        
        // 检测是否咬到目标
        const dist = distanceTo(this._target.node.position);
        if (dist < SHARK_TUNING.collisionRadius + swimmerCollisionRadius) {
            this.eliminateSwimmer(this._target);
        }
    }
    
    // 追击超时
    if (this._huntTimer >= SHARK_TUNING.huntTimeout) {
        this.enterWander();
    }
}
```

**findNearestSwimmer 的实现：**

```typescript
findNearestSwimmer(): Swimmer | null {
    let nearest: Swimmer | null = null;
    let nearestDist = Infinity;
    for (const swimmer of this._activeSwimmers) {
        // 只考虑还在比赛中的选手（未被淘汰、未完赛）
        if (!swimmer.isSharkTargetable) continue;
        const dist = distanceSqr(this.node.position, swimmer.node.position);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearest = swimmer;
        }
    }
    return nearest;
}
```

### 5.4 鲨鱼碰撞接入现有系统

鲨鱼参与碰撞的方式和选手之间的碰撞不同 -- 鲨鱼不被选手推开，但选手会被鲨鱼推开。

**修改 `SwimmerCollisionResolver.ts`：**

在 `resolveSwimmerCollisions()` 之后增加一个 `resolveSharkCollisions()`：

```typescript
export function resolveSharkCollisions(
    shark: SharkEntity, 
    swimmers: readonly Swimmer[]
): void {
    if (shark.state === SharkState.SATIATED) return; // 吃饱了不碰撞
    
    const sharkPos = shark.node.position;
    const sharkRadius = SHARK_TUNING.collisionRadius;
    
    for (const swimmer of swimmers) {
        if (!swimmer.isCollisionActive) continue;
        
        const dx = swimmer.node.position.x - sharkPos.x;
        const dz = swimmer.node.position.z - sharkPos.z;
        const distSq = dx * dx + dz * dz;
        const minDist = sharkRadius + SWIMMER_COLLISION.radius;
        
        if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            const pushDist = minDist - dist;
            // 选手被鲨鱼推开（单向，鲨鱼不动）
            const nx = dist > 0 ? dx / dist : 0;
            const nz = dist > 0 ? dz / dist : 1;
            swimmer.applyCollisionPush(nx * pushDist, nz * pushDist);
            swimmer.flashCollision();
        }
    }
}
```

注意：HUNT 状态下鲨鱼碰到目标时直接淘汰，不走普通碰撞推开逻辑。碰撞推开只在 WANDER 和 WARNING 阶段生效。

### 5.5 选手被鲨鱼淘汰的处理

**修改 `Swimmer.ts`：**

新增淘汰状态和相关方法：

```typescript
// 新增字段
private _eliminated = false;

// 鲨鱼是否可以追击这个选手
get isSharkTargetable(): boolean {
    return this._motor.isRacing
        && this.node.active
        && !this._eliminated
        && !this._phases.isFlipTurnActive
        && !this._phases.isUnderwater;
}

// 被鲨鱼淘汰
eliminateByShark() {
    this._eliminated = true;
    this._motor.stopRace();
    
    // 播放被拖走动画：角色沉入水下 + 向鲨鱼方向移动
    // 先用简单的 Tween 实现，后续替换为正式动画
    Tween.stopAllByTarget(this.node);
    const sinkY = this.node.position.y - 1.5;
    tween(this.node)
        .to(0.3, { position: new Vec3(this.node.position.x, sinkY, this.node.position.z) })
        .call(() => {
            this.node.active = false; // 隐藏节点
        })
        .start();
    
    // 通知 RaceManager
    this._onEliminated?.(this);
}
```

**修改 `RaceManager.ts`：**

新增淘汰管理逻辑：

```typescript
// 新增字段
private _eliminatedCount = 0;
private readonly _eliminatedSwimmers = new Set<Swimmer>();
public onSwimmerEliminated: ((swimmer: Swimmer) => void) | null = null;

// 选手被淘汰时调用
eliminateSwimmer(swimmer: Swimmer) {
    if (this._eliminatedSwimmers.has(swimmer)) return;
    
    this._eliminatedSwimmers.add(swimmer);
    this._eliminatedCount++;
    
    // 从活跃选手中移除（activeRacers 不再包含被淘汰的）
    swimmer.eliminateByShark();
    
    this.onSwimmerEliminated?.(swimmer);
}

// 修改 activeRacers() 排除被淘汰的选手
private activeRacers(): Swimmer[] {
    const racers: Swimmer[] = [];
    if (this.playerSwimmer?.node.active && !this._eliminatedSwimmers.has(this.playerSwimmer)) {
        racers.push(this.playerSwimmer);
    }
    for (const swimmer of this.activeAiSwimmers()) {
        if (this._eliminatedSwimmers.has(swimmer)) continue;
        if (racers.indexOf(swimmer) < 0) {
            racers.push(swimmer);
        }
    }
    return racers;
}
```

**关键点：被淘汰的选手不参与 finishLeaderboard 的正常排名计算。** 他们以"被淘汰"的身份记录在结果中，排名在所有完赛选手之后。

### 5.6 鲨鱼在泳池中的移动范围

鲨鱼的移动范围需要限制在泳池水域内。复用 `RaceCourseLayout` 的边界数据：

```typescript
// SharkController 中
private clampToPoolBounds() {
    const layout = this._courseLayout;
    const pos = this.node.position;
    
    // X 轴：限制在泳池起点和终点之间（留一点 margin）
    const marginX = 2.0;
    const minX = Math.min(layout.poolStartX, layout.poolFinishX) + marginX;
    const maxX = Math.max(layout.poolStartX, layout.poolFinishX) - marginX;
    
    // Z 轴：限制在泳池宽度内（留一点 margin）
    const marginZ = 1.0;
    const halfWidth = layout.poolWidth * 0.5 - marginZ;
    
    this.node.setPosition(
        Math.max(minX, Math.min(maxX, pos.x)),
        pos.y,
        Math.max(-halfWidth, Math.min(halfWidth, pos.z))
    );
}
```

### 5.7 鲨鱼阶段切换的时序控制

在 `GameFlowController` 或新建 `SharkPhaseScheduler` 来控制鲨鱼的阶段切换时序：

```typescript
// 鲨鱼阶段调度（由 GameFlowController 在 RACING 状态下每帧调用）
updateShark(dt: number) {
    if (this._refs.getState() !== GameState.RACING) return;
    
    this._sharkRaceElapsed += dt;
    
    // 第一次饥饿触发（比赛开始后 15 秒）
    if (!this._firstHuntTriggered && this._sharkRaceElapsed >= 15.0) {
        this._firstHuntTriggered = true;
        this._sharkController.enterWarning();
    }
    
    // 鲨鱼自身的状态机更新（游荡/预警/追击/吃饱的切换）
    this._sharkController.update(dt, this._refs.activeSwimmers());
    
    // 鲨鱼碰撞检测
    resolveSharkCollisions(this._sharkEntity, this._refs.activeSwimmers());
}
```

### 5.8 体能恢复逻辑实现

**修改 `PlayerConditionModel.ts` 的 `tick()` 方法：**

```typescript
// 新增配置（加到 ConditionBalance.ts）
energy: {
    // ... 现有配置 ...
    
    // 不划水时的体能恢复速率（每秒恢复的点数）
    // 很慢：全程不划水 80 秒约恢复总量的 1/4 到 1/3
    // total=100, recoveryPerSecond=0.4 => 80秒恢复32点
    recoveryPerSecond: 0.4,
    
    // 不划水的判定阈值（秒），超过这个时间没划水才开始恢复
    recoveryIdleThreshold: 0.5,
},

// tick() 方法中新增
tick(dt: number) {
    this._timeSinceLastStroke += dt;
    
    // ... 现有心率 drift 逻辑不变 ...
    
    // 新增：体能恢复
    if (this._timeSinceLastStroke > CONDITION_BALANCE.energy.recoveryIdleThreshold
        && this._energy < CONDITION_BALANCE.energy.total) {
        this._energy = Math.min(
            CONDITION_BALANCE.energy.total,
            this._energy + CONDITION_BALANCE.energy.recoveryPerSecond * dt
        );
        this._energyDepleted = false; // 恢复后清除耗尽标志
    }
    
    // ... refreshModifiers() 不变 ...
}
```

**修改 `AiConditionModel.ts` 的 `tickAi()` 方法：**

```typescript
// drainEnergy 方法中新增恢复逻辑
private drainEnergy(difficulty: number, dt: number) {
    const energyCfg = CONDITION_BALANCE.energy;
    
    // AI 也有恢复逻辑（AI 停止划水时恢复）
    // AI 的 "停止划水" 判定通过 difficulty 和 progress 的曲线模拟
    const aiStrokeRate = this.estimateAiStrokeRate(difficulty, this._phase);
    if (aiStrokeRate < 0.1) {
        // AI 低频划水时恢复
        this._energy = Math.min(
            energyCfg.total,
            this._energy + energyCfg.recoveryPerSecond * dt
        );
        this._energyDepleted = false;
        return;
    }
    
    // ... 现有消耗逻辑不变 ...
}
```

### 5.9 冲刺自动触发与体能额外消耗

**修改 `SwimmerMotor.ts`：**

```typescript
// 新增字段
private _strokeRateWindow: number[] = []; // 最近几次划水的时间戳
private _isSprinting = false;

// 在划水结算时检测划水频率
private settleStroke(stroke: StrokeAction, currentTime: number) {
    // ... 现有结算逻辑 ...
    
    // 记录划水时间戳，检测频率
    this._strokeRateWindow.push(currentTime);
    // 只保留最近 3 秒内的划水
    while (this._strokeRateWindow.length > 0 
           && this._strokeRateWindow[0] < currentTime - 3.0) {
        this._strokeRateWindow.shift();
    }
    
    // 计算划水频率（次/秒）
    const windowDuration = 3.0;
    const strokeRate = this._strokeRateWindow.length / windowDuration;
    
    // 超过阈值则进入冲刺状态
    const sprintThreshold = MOTION_TUNING.sprintStrokeRateThreshold ?? 2.5; // 每秒2.5次以上算冲刺
    this._isSprinting = strokeRate >= sprintThreshold;
}

get isSprinting(): boolean {
    return this._isSprinting;
}
```

**体能消耗与冲刺状态挂钩：**

在 `PlayerConditionModel.updateFromStroke()` 中，当 `_isSprinting` 为 true 时，体能消耗乘以冲刺倍率。这个逻辑实际上已经通过心率区间间接实现了 -- 划得快心率会升到 HIGH_PRESSURE / OVERLOAD，消耗自动增加。但可以加一个额外的冲刺倍率让它更明显：

```typescript
private drainEnergyForStroke() {
    const energyCfg = CONDITION_BALANCE.energy;
    let drain = energyCfg.drainPerStroke[this._heartRateZone];
    if (this._phase === RacePhase.SPRINT) {
        drain *= energyCfg.sprintTierMultiplier[this._sprintTier];
    }
    // 新增：非冲刺阶段但划水频率过高也额外消耗
    // 这个通过心率区间已经间接实现了，不需要额外代码
    this._energy = clamp(this._energy - drain, 0, energyCfg.total);
    this._energyDepleted = this._energy <= 0;
}
```

实际上现有代码的心率区间消耗机制已经支持了你想要的效果：划得快 -> 心率升高 -> 消耗倍率自动从 1.0 (OPTIMAL) 升到 1.5 (HIGH_PRESSURE) 再到 2.5 (OVERLOAD)。不需要额外加冲刺检测，心率系统天然就是冲刺检测器。

**体能条闪烁提示：**

修改 `UIController.ts`，当心率在 HIGH_PRESSURE 或 OVERLOAD 区间时，体能条边缘闪烁：

```typescript
updateEnergyBar(energy: number, depleted: boolean, heartRateZone?: HeartRateZone) {
    // ... 现有逻辑 ...
    
    // 心率高时体能条闪烁提示
    if (heartRateZone === HeartRateZone.HIGH_PRESSURE 
        || heartRateZone === HeartRateZone.OVERLOAD) {
        // 体能条边缘闪烁
        this.flashEnergyBarBorder();
    }
}
```

### 5.10 鲨鱼的视觉表现（初版）

初版用程序化几何体，不依赖外部模型：

```
鲨鱼身体：拉长的椭圆体（用 Cocos primitives.createCapsule 或 createSphere 拉伸）
背鳍：三角形（用 primitives.createBox 压扁成三角形）
眼睛：两个小球，颜色可切换（白色 -> 红色）
```

材质用单色 unlit 材质，灰色身体 + 白色腹部。后续替换为正式模型。

鲨鱼在水面的 Y 坐标略低于选手（半潜状态），只露出背鳍和身体上半部分，营造"鲨鱼鳍"的视觉。

### 5.11 鲨鱼淘汰动画（初版）

选手被鲨鱼淘汰时的表现：

1. 选手身体快速下沉 0.3 秒（Y 下降 1.5m）
2. 水面冒出几个泡泡粒子（复用 `SplashEmitter`）
3. 选手节点隐藏
4. 鲨鱼短暂停顿 0.5 秒（"吃"的动作）
5. 弹出淘汰文案 "XX 被鲨鱼拖走了"
6. 鲨鱼回到游荡或进入吃饱

初版用 Tween 实现下沉，后续可以替换为正式的"被拖走"动画。

## 6. 与现有代码的对接总结

### 6.1 体能系统（已存在，需扩展）

| 现有代码 | 状态 | 需要做的 |
|---------|------|---------|
| `PlayerConditionModel._energy` / `_energyDepleted` | 已有 | 不改 |
| `PlayerConditionModel.drainEnergyForStroke()` | 已有，按心率区间消耗 | 不改，现有消耗曲线已满足需求 |
| `ConditionBalance.energy.drainPerStroke` | 已有，OPTIMAL 1.0 / HIGH_PRESSURE 1.5 / OVERLOAD 2.5 | 不改 |
| `ConditionBalance.energy.sprintTierMultiplier` | 已有，STEADY 1.0 / PUSH 1.6 / GAMBLE 2.5 | 不改 |
| 体能恢复逻辑 | **不存在** | **新增**：`tick()` 中不划水时缓慢恢复 |
| `AiConditionModel.drainEnergy()` | 已有消耗逻辑 | **修改**：加恢复分支 |
| 体能耗尽惩罚 | 已有 `depletedQualityPenalty` / `depletedEfficiencyPenalty` | 不改 |
| 体能条 UI | 已有 | **修改**：加闪烁提示 |
| 冲刺自动触发 | 心率区间间接实现 | 不需要额外代码，心率系统天然检测划水频率 |

### 6.2 鲨鱼系统（全新，需创建）

| 新增内容 | 文件 | 说明 |
|---------|------|------|
| 鲨鱼调参常量 | `entity/SharkEntity.ts` (或 `core/SharkTuning.ts`) | `SHARK_TUNING` 配置对象 |
| 鲨鱼状态机 | `entity/SharkController.ts` | WANDER / WARNING / HUNT / SATIATED 状态切换 |
| 鲨鱼碰撞 | `entity/SwimmerCollisionResolver.ts` (修改) | 新增 `resolveSharkCollisions()` |
| 选手淘汰 | `entity/Swimmer.ts` (修改) | 新增 `_eliminated` 字段、`eliminateByShark()` |
| 淘汰管理 | `core/RaceManager.ts` (修改) | 新增 `_eliminatedSwimmers`、`activeRacers()` 排除被淘汰的 |
| 鲨鱼阶段调度 | `app/GameFlowController.ts` (修改) | RACING 状态下更新鲨鱼 |
| 鲨鱼视觉 | `entity/SharkEntity.ts` | 程序化几何体初版 |

### 6.3 不需要改动的部分

- 划水节奏系统（`SwimmerMotor` / `SwimPhysicsModel`）：核心不变。
- 蛇形转向系统（`SteeringTuning` / `SwimmerMotor` 的 steering 逻辑）：核心不变。
- 赛前展示 / 赛后颁奖流程：不变，只是比赛过程多了鲨鱼。
- 角色动画（`FreestylePoseController` / `CharacterPoseStateController`）：不变。
- 泳池场景（`VenueManager` / `RaceCourseLayout`）：核心不变，鲨鱼移动范围复用泳池边界。

## 7. 设计决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 鲨鱼数量 | 1 条 | 两条鲨鱼认知负担大，休闲玩家会懵 |
| 淘汰上限 | 3 人 | 吃 3 个剩 5 个冲终点，5 人比 4 人更拥挤更混乱 |
| 鲨鱼追人规则 | 追最近的人，可逃脱 | 休闲玩家需要希望感，"鲨鱼转头追别人"有喜剧效果 |
| 体能恢复方式 | 不划水时缓慢恢复 | 正常划水不恢复，只有主动停顿才有收益，代价是落后 |
| 体能恢复速率 | 0.4/秒（80秒约恢复32点） | 很慢，不能太强，停顿代价大 |
| 冲刺触发方式 | 自动触发（心率区间间接实现） | 现有心率系统天然检测划水频率，不需要额外代码 |
| 体能耗尽后果 | 减速但不停摆 | 完全停摆太惩罚，休闲玩家会崩溃 |
| 鲨鱼是否改变核心玩法 | 不改变，是策略层 | 核心还是划水+转向+碰撞，鲨鱼增加随机性和策略博弈 |
| 追击超时 | 8 秒未咬到则放弃 | 避免鲨鱼一直追同一个人 |
| 鲨鱼碰撞 | 选手被推开，鲨鱼不被推 | 鲨鱼是环境威胁，不是可推动的物体 |
| 玩家被淘汰后 | 直接结束本局，弹出结算页，可立刻开下一局 | 不等 AI 比完，休闲玩家不耐烦 |
| 被淘汰结算页标题 | 改为「你被鲨鱼拖走了」+ 实际排名 | 搞笑 + 让玩家知道自己排第几 |
| 排行榜被淘汰者显示 | 时间列显示「被鲨鱼拖走」，不显示速度 | 区分完赛和淘汰 |
| 吃饱文案位置 | 屏幕中央临时提示，2 秒淡出 | 不持续占用 UI 空间 |
| 淘汰动画期间比赛 | 不暂停，其他人继续游 | 不打断比赛节奏 |
| AI 应对鲨鱼 | 不做特殊应对，纯看运气和位置 | 简单，有的 AI 傻乎乎被吃更有搞笑感 |
| 鲨鱼游荡路线 | 完全随机方向 | 最混乱，不可预判 |
| 鲨鱼出现时机 | 比赛开始时就在池中游荡 | 前 15 秒能看到鲨鱼但不咬人 |
| 鲨鱼碰撞推力 | 比选手之间碰撞力度更大 | 鼓励绕路而非硬挤 |
| 选手间碰撞消耗体能 | 不消耗 | 体能只受划水节奏影响，简单 |
| 锁定线表现 | 被锁定者头顶鲨鱼图标 | 画面干净，玩家看一处即可 |
| 鲨鱼追击速度 | 略快于选手 maxSpeed | 正常游被追上，冲刺才能甩开 |
| 目标切换 | 纯最近距离，每 0.5 秒检测 | 简单直接 |

## 8. 待后续讨论

- 鲨鱼的正式模型和动画（初版用程序化几何体）
- 鲨鱼淘汰动画的正式版（初版用 Tween 下沉）
- 假安全转折的 UI 设计细节
- 体能恢复速率的具体数值（需实测调参，初版 0.4/秒）
- 鲨鱼饥饿阶段的时间间隔和总赛制时长的最终确定
- 鲨鱼对 AI 选手的影响（AI 如何逃避鲨鱼，AI 被淘汰后是否补位）
- 多人模式下被淘汰玩家的观战/快速重开流程
