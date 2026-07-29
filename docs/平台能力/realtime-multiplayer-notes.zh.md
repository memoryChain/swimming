# 实时对战（联机）技术要点

本文记录把当前单机游泳竞速游戏演进到「实时对战」需要的技术改造点，方便日后分阶段实现。
先读结论，再看清单。

## 0. 结论速览

- 当前物理/运动/计时系统**天然确定性强**（纯数学 + `dt` 累积计时，无墙钟），这是帧同步最难改的部分，我们已经基本满足。
- 真正的工作量集中在三块：**随机数确定化**、**固定逻辑步长 + 输入帧化**、**从零搭一层网络**。
- 「服务器只做转发」的理解方向对，但服务器至少还要负责：**发种子、定帧节拍、当裁判、管房间/断线**。
- 玩法是 2~6 人竞速「看谁先到」。**推荐先做「状态同步 + 客户端预测」拿到可玩联机版**，把匹配/房间/断线跑通；将来要强竞技排位/防作弊/回放时再演进到严格帧同步。现有确定性地基不会白做。
- **★微信平台重大利好（见第 7 节）**：微信小游戏自带一整套托管「游戏服务」（房间 + 匹配 + 帧同步转发 + 断线补帧 + 回放）。这意味着在微信上，**实时对战的服务器几乎可以不自建**——房间/匹配/帧转发全由微信托管，你只需要一个云函数级别的轻量后端处理登录换 openid 和存档。这正好命中「借助微信能力做房间和匹配、服务器轻量化」的目标。

---

## 1. 两种主流方案

### 方案 A：帧同步 / 锁步（lockstep）
- 所有客户端跑同一套确定性逻辑；服务器只转发**输入指令**（不转发位置）。
- 优点：带宽极低、天然公平、可回放、可服务器复算防作弊。
- 缺点：**一慢全慢**（任一玩家卡顿全场等待或分叉）；对确定性要求苛刻（一个 `Math.random()` 就崩）；跨端浮点必须对账。

### 方案 B：状态同步 + 客户端预测（推荐先做）
- 每个客户端本地跑自己的泳者（复用现有确定性物理，几乎零改动），**定期上报自己的进度/速度/名次**（如每 100~200ms）。
- 服务器汇总广播给所有人，对手用**插值 / ghost** 显示，不需要精确物理。
- 名次由服务器根据上报到达时间裁定。
- 优点：不需要严格确定性、不会「一慢全慢」、抗延迟好、上手快。对「看谁先到」玩家几乎无感差异。
- 缺点：需要处理预测偏差平滑；对手位置是近似而非逐帧精确。

**推荐路线**：先 B（快速可玩），后续需要竞技级公平时再上 A。

---

## 2. 已完成的第一步：随机数确定化（SharedRNG）

帧同步铁律：**同样的输入必须算出同样的结果**。任一 `Math.random()` 在模拟路径里都会让两台设备分叉。

- 新增 `assets/scripts/core/SharedRNG.ts`：可播种 `mulberry32` PRNG（整数确定、跨 JS 引擎一致、零 GC，适配微信小游戏）。
- **单机默认**用 `entropySeed()`（`Date.now ^ Math.random`）播种，每次启动仍然随机——现有手感不变。
- **联机时**：host 生成一个 32-bit seed，开局广播；各端 `reseedSharedRandom(seed)`，此后 AI、赛道抽签、对手名单全部一致。
- 纯视觉随机（水花、彩带、转播机位随机、被淘汰后的观战目标）**故意保留 `Math.random()`**：不影响胜负，各端不同步也无所谓。

### API
```ts
// 实例（需要连续多次取值时）
const rng = new SeededRandom(seed);
rng.next();            // [0,1)
rng.range(min, max);
rng.int(maxExclusive);
rng.gaussian();
rng.pick(array);
rng.shuffle(array);    // 原地 Fisher-Yates

// 共享单例辅助（大多数调用点用这个）
randomFloat(); randomRange(min,max); randomInt(n); randomGaussian(); shuffleInPlace(arr);
reseedSharedRandom(seed);   // 开局用 host seed 重播种
getSharedRandomSeed();      // 记录当前 seed（用于复现/回放）
sharedRandom();             // 取共享实例
```

### 已改为走共享流的点（影响比赛结果）
- `entity/AISwimmerController.ts`：起步延迟、划手间隔抖动、转向决策（两处）、泳道锁定感知、划手释放时机高斯噪声（删掉了本地 `randomRange` / `gaussian`）。
- `app/GameFlowController.ts`：`aiDiveReactionDelay`、`aiDivePower`。
- `competitor/CompetitorConfig.ts`：`shuffleInPlace`（AI 名单 + 名字分配）。
- `competitor/CompetitorManager.ts`：AI 泳衣配色、肤色洗牌。
- `competitor/SwimmerFactory.ts`：`randomAiModelVariantId`（AI 模型选择）。
- `core/GameManager.ts`：`assignRaceLanes`（玩家泳道抽签）。

> 现在「固定 seed → 单机重放，结果一致」已经成立。这是联机确定性的第一块地基。

---

## 3. 还需要实现的技术点（按优先级）

### 3.1 固定逻辑步长（Fixed timestep）— 帧同步必需
- 现状：`GameManager.update(dt)` 用引擎变长 `dt` 驱动，计时是 `dt` 累积（对帧同步友好），但步长不固定。
- 改造：加逻辑帧累加器，逻辑以固定步（如 33ms / 30Hz）推进，渲染层做插值。避免不同设备 `dt` 不同导致浮点漂移。
- 影响文件：`core/GameManager.ts`（update 主循环）、可能抽出一个 `FixedStepDriver`。

### 3.2 输入帧化（Input framing）
- 现状：`core/InputRouter.ts` 用 `Date.now()` 判断长按时长（本地无碍）。
- 改造：输入表示为 `(帧号, 左/右, 按下/抬起)`；玩家在第 N 帧点击就广播「第 N 帧 左划」，各端执行到第 N 帧统一应用。
- 现有优势：输入已经是「入队 → tick 消费」（`SwimmerMotor` 划手队列），与状态解耦，改造成本低。
- 影响文件：`core/InputRouter.ts`、`swimmer/SwimmerMotor.ts`（队列 already ok）、`app/GameFlowController.ts`（转发入口）。

### 3.3 网络层（从零）
- 新增 `NetworkManager`：连接、房间、帧/状态收发、seed 分发、断线重连。
- 微信小游戏用 `wx.connectSocket`（WebSocket）。
- 定义消息协议：`JoinRoom / RoomState / StartRace(seed, lanes, startTime) / InputFrame / StateSnapshot / Finish / Leave`。
- 影响文件：新增 `core/net/*`；`core/GameManager.ts` 接入初始化与回调。

### 3.4 浮点一致性对账（帧同步方案才需要）
- 纯 JS + 微信各端同引擎，浮点风险比 C++/C# 小，但 `Math.pow/sin` 等长时间累积仍可能分叉。
- 缓解：服务器定期收 checksum（关键状态哈希）对账，发现分叉以权威端为准纠正。
- 相关：`swimmer/SwimPhysicsModel.ts`、`swimmer/SwimmerMotor.ts`、`entity/SwimmerCollisionResolver.ts`。

### 3.5 AI 在联机下的处理
- AI 是「模拟输入」系统，走玩家同款物理。给定 seed + 输入即可各端本地一致计算（已随 SharedRNG 就绪）。
- 两种接法：① 各端本地算 AI（省带宽，需 seed + 严格确定）；② host 算 AI 并广播其决策（简单但费带宽）。
- 状态同步方案（B）下，AI 也可只由 host 计算并随快照广播，其它端仅显示。
- 相关：`entity/AISwimmerController.ts`、`competitor/CompetitorManager.ts`、`competitor/CompetitorConfig.ts`、`competitor/AIRaceObserver.ts`。

### 3.6 碰撞一致性
- `entity/SwimmerCollisionResolver.ts` 是手写 XZ 圆盘分离，确定性好，但要保证遍历顺序、迭代次数各端一致。
- 帧同步下需要把参与碰撞的选手集合与顺序固定化。

### 3.7 比赛流程 / 裁判
- `core/RaceManager.ts`（及 `core/LaneLockdownRaceController.ts`）已用 `dt` 累积计时、结果由距离/速度决定，天然适配。
- 联机需加：开局同步（统一倒计时起点）、名次以服务器裁定为准、DNF/断线判定。

### 3.8 房间 / 匹配 / 断线重连
- 匹配 2~6 人组局、分配赛道、断线重连、超时判负、观战。
- 需要一个轻量服务端（Node.js WebSocket 即可）。

---

## 4. 服务器职责清单（回答「是不是转发就行」）

即便走最轻的方案，服务器至少要做：
1. **匹配 / 房间**：凑齐玩家、分配赛道。
2. **开局同步**：广播 `seed + 赛道 + 开始时间`，让各端同时倒计时。
3. **转发**：帧同步转发输入；状态同步转发进度快照。
4. **裁判**：确定最终名次、记录成绩、明显作弊校验。
5. **容错**：断线、重连、超时判定。

结论：转发是主干，但「发种子、定帧节拍、当裁判、管房间」不能省。

---

## 5. 涉及文件总览

| 分类 | 文件 | 说明 |
|---|---|---|
| 已完成 | `core/SharedRNG.ts` | 可播种确定性随机（新增） |
| 已完成 | `entity/AISwimmerController.ts` / `app/GameFlowController.ts` / `competitor/CompetitorConfig.ts` / `competitor/CompetitorManager.ts` / `competitor/SwimmerFactory.ts` / `core/GameManager.ts` | 结果相关随机改走共享流 |
| 待做·核心 | `core/GameManager.ts` | 固定步长驱动、网络初始化与回调 |
| 待做·核心 | 新增 `core/net/NetworkManager.ts` 等 | 连接/房间/收发/seed/重连 |
| 待做·输入 | `core/InputRouter.ts`、`app/GameFlowController.ts` | 输入帧化、网络延迟容限 |
| 待做·模拟 | `swimmer/SwimmerMotor.ts`、`swimmer/SwimPhysicsModel.ts`、`entity/SwimmerCollisionResolver.ts` | 确定性对账（帧同步方案） |
| 待做·比赛 | `core/RaceManager.ts`、`core/LaneLockdownRaceController.ts` | 开局同步、裁判、DNF/断线 |
| 待做·AI | `entity/AISwimmerController.ts`、`competitor/*` | 本地一致计算或 host 广播 |

---

## 6. 建议里程碑

1. **M0（已完成）**：SharedRNG + 结果相关随机确定化；固定 seed 单机可复现。
2. **M1**：轻量 WebSocket 服务端 + 房间/匹配 + 开局广播 seed/赛道/起点。
3. **M2（方案 B）**：进度快照上报 + 对手 ghost 插值 + 服务器裁定名次 → 首个可玩联机版。
4. **M3**：断线重连、观战、超时判负、基础反作弊（服务器复核成绩）。
5. **M4（可选，方案 A）**：固定步长 + 输入帧化 + checksum 对账 → 严格帧同步、回放、竞技排位。

---

## 7. 微信小游戏官方「游戏服务」（重点：服务器可极轻）

微信提供一套托管的**游戏服务**，通过 `wx.getGameServerManager()` 拿到 `GameServerManager` 使用。包含四个子服务：

| 子服务 | 能力 |
|---|---|
| **帧同步游戏服务（lock-step）** | 微信服务器托管对局、按 `gameTick`（默认 33ms）向全房间**下发帧**、断线重连**自动补帧**、对局帧可回放拉取 |
| **房间服务** | `createRoom` / `joinRoom` / `updateReadyStatus` / `changeSeat` / `kickoutMember` / `broadcastInRoom` / `onRoomInfoChange` |
| **对局匹配** | `startMatch` / `cancelMatch` / `onMatch`（微信托管撮合） |
| **好友状态与在线邀请** | `inviteFriend` / `onInvite` / `getFriendsStateData`（需开放数据域） |

### 7.1 这对我们意味着什么
**房间、匹配、帧转发、断线补帧、回放——全部微信托管，实时对战部分基本不用自建服务器。** 「服务器只做转发」这件事微信已经替你做了，而且做得比自建更稳（UDP + 冗余帧策略）。

### 7.2 边界：微信做 vs 你的轻量服务器做

| 职责 | 谁来做 |
|---|---|
| 房间创建/加入/准备/踢人/广播 | **微信**（GameServerManager 房间服务） |
| 匹配撮合（2~6 人组局） | **微信**（`startMatch` + `onMatch`） |
| 逐帧输入转发、帧节拍、断线补帧 | **微信**（lock-step，`uploadFrame` / `onSyncFrame` / `reconnect` / `getLostFrames`） |
| 对局帧回放/校验数据 | **微信**（后台 HTTPS `getgameframe`） |
| 登录换 openid（存档/养成识别用户） | **你的轻量后端**（`wx.login` code → `code2session`） |
| 打开匹配 matchId 开关 | **你的轻量后端**（后台 HTTPS `gamematch.setMatchIdOpenState`，一次性） |
| 存档 / 养成 / 排行榜数据 | **你的轻量后端**（openid → 玩家数据；与实时对战无关） |
| （可选）结算防作弊复核 | **你的轻量后端**（拉 `getgameframe` 复算） |

> 结论：微信平台上，你的服务器可以退化成**一个云函数**（CloudBase / 微信云开发即可），只处理登录和存档；实时对战一行转发代码都不用写。

### 7.3 帧同步流程（映射到我们现有代码）
1. `GameServerManager.login()` 连上游戏服务（这是游戏服务的登录，**不需要你的服务器**；跟 `wx.login` 换 openid 是两码事）。
2. `startMatch()` 匹配 → `onMatch` 拿到房间 → 或直接 `createRoom` / `joinRoom`（好友房）。
3. 全员 `updateReadyStatus` 就绪 → 各端 `startGame()` → `onGameStart`。
4. **每逻辑帧**：本端把玩家输入 `uploadFrame(actions)`；微信按 `gameTick` 把全房间输入合并成一帧通过 `onSyncFrame({frameId, actionList})` 下发。
5. 各端在 `onSyncFrame` 里**推进一个固定逻辑步**，应用所有人的输入 → 复用我们确定性的 `SwimmerMotor`/`SwimPhysicsModel`/碰撞。**微信的帧节拍天然帮我们实现了「固定逻辑步长」**（第 3.1 节的一部分工作被它接管）。
6. **随机种子**：房主开局用 `broadcastInRoom` 或放进房间数据，把一个 32-bit seed 发给所有人 → 各端 `reseedSharedRandom(seed)`（第 2 节已就绪）→ AI/赛道/名单一致。
7. 断线：`onDisconnect` → `reconnect()` 拿到 `maxFrameId` → `onSyncFrame` 补回缺帧；补帧期间 `frameId` 可能「回放旧帧」，**以服务端为准推进，别丢**。

### 7.4 构建配置
`game.json` 需加 `lockStepOptions`（`gameTick` 默认 33ms、`heartBeatTick`、`offlineTimeLength`、`UDPReliabilityStrategy` 冗余帧数、`dataType` String/ArrayBuffer）。这属于导出产物的 `game.json`，应通过 Cocos 编辑器构建扩展（`extensions/`，参考已有 `wechat-race-subpackage`）在构建期注入，别手改导出目录。

### 7.5 跨平台注意
以上是**微信专有**。抖音（`tt`）也有类似的实时对战/房间能力，但 API 不同。所以联机层要像平台层一样做抽象：定义一个 `INetRoom`（createRoom/join/match/uploadFrame/onSyncFrame/...）接口，微信实现用 `GameServerManager`，抖音单独实现，游戏逻辑只认接口。放在 `assets/scripts/net/` 下，和 `platform/` 同思路。

### 7.6 官方示例
帧同步 demo：https://github.com/wechat-miniprogram/minigame-lockstep-demo （可直接参考房间/匹配/上传帧/补帧的完整时序）。

### 7.7 好友对战的三种组队方式（房间 accessInfo 是核心）
`createRoom` 成功返回 `accessInfo`（房间唯一标识）。三种拿到 `accessInfo` 的路径，按上手难度排：

1. **房间号（最简单，先做）**：房主 `createRoom({maxMemberNum, startPercent:100, needUserInfo})` → 把 `accessInfo` 当房间号分享给好友 → 好友 `joinRoom({accessInfo, memberExtInfo})`。`memberExtInfo` 可带每人选的角色/皮肤。
2. **好友邀请（体验最好，后做）**：`startStateService` 开启后，开放数据域用 `getFriendsStateData` 拿在线好友、`inviteFriend({openId})` 邀请；对方 `onInvite`（接受才回调）。⚠️ 好友列表/发邀请**必须在开放数据域（子域）**，要多做子域 + `postMessage` 通信。
3. **匹配（陌生人，最后做）**：见 7.8。

开局前用 `broadcastInRoom({msg})` + `onBroadcast` 同步 seed、选人、准备状态；全员 `updateReadyStatus` 就绪后各端 `startGame()`。房间无活动缓存 2 小时。

### 7.8 对局匹配（gamematch，陌生人快速对战，零自建匹配服务器）
- 后台 HTTPS `createMatchRule` 申请 `matchid`（`team_count` / `team_member_count`，最多 20 个池）。
- **`need_room_service=1`：匹配成功自动创建帧同步房间并返回 `accessInfo`**（对局 ≤10 人可用）——匹配完直接给可开局房间，省一步。
- 客户端：`startMatch({matchId, fillType})` / `cancelMatch` / `onMatch`（生命周期内至多监听一个）。断开 websocket 会自动移出匹配池。

### 7.9 排行榜 / 成绩存档用 `RankManager`（微信托管，免服务器，跨设备）
- `wx.getRankManager().update({scoreKey, score})` 上报；`getScore({scoreKeys, periodType})` 查询（4=历史最高、1/2/3=日/周/月、5=最新）。
- 玩法 ID 在 MP 后台配，**游泳「最快完成时间」用「时间型」**。
- 适合排行榜/最快成绩/最高分/简单进度，**跨设备自动、免服务器**。养成货币仍走 CloudBase 云函数（见后端设计文档 2.5）。

### 7.10 建议里程碑（微信优先版，替代上面的 M1/M2）
1. **W1**：接入 `GameServerManager`，跑通 `login → createRoom → joinRoom → startGame → uploadFrame/onSyncFrame` 的 2 人好友房（房间号手动加入，先不做匹配）。
2. **W2**：开局广播 seed + 各端 `reseedSharedRandom`，把 `onSyncFrame` 接到确定性模拟，2 人同屏一致跑完一局。
3. **W3**：接 `startMatch` 匹配（后台先 `createMatchRule` 申请 matchid、`setMatchIdOpenState` 打开），断线 `reconnect` + 补帧，超时/退出处理。
4. **W4**：轻量云函数做养成货币权威 + 存档；成绩/排行榜用 `RankManager`；好友邀请（开放数据域）体验升级。


