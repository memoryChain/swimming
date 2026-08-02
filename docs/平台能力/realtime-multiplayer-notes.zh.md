# 实时对战（联机）技术要点

本文记录把当前单机游泳竞速游戏演进到「实时对战」需要的技术改造点，方便日后分阶段实现。
先读结论，再看清单。

> **维护者请先读第 8 节**「实战：当前实现的架构与踩坑」——那是已经真机落地的架构、微信硬事实清单和一路踩的坑。第 1~7 节是早期设计规划（部分已被第 8 节的实际做法取代，如：最终不是纯帧同步而是混合模型、再来一局用保活会话而非重新建房）。

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

---

## 8. 实战：当前实现的架构与踩坑（真机验证过，2026-08）

> 这一节记录**实际落地后**的架构和一路踩的坑。上面 1~7 是设计规划，这一节是「维护这套代码时你真正需要知道的东西」。**改联机前先读这一节。**

### 8.1 我们最终用的不是纯帧同步，而是「混合模型」

严格帧同步（各端逐比特一致）**做不到**：iOS 用 JavaScriptCore、安卓用 V8，`Math.sin/cos` 最后几位不同（`SwimmerMotor.updateSteering` 的 heading 计算），跨引擎浮点必然分叉。所以我们走**「本地预测 + 权威校正」的混合模型**：

- **每个客户端本地跑完整模拟**（复用单机的 `SwimmerMotor`/物理/碰撞），要手感、零输入延迟。
- **真人位置 = 各自权威（self-authoritative）**：每个人把自己玩家的权威位置广播出去，别人把这个真人的屏上副本**追（catch-up）到 owner 自报的位置**。owner 本地零延迟预测=真值。
- **AI = 房主权威（host-authoritative）**：AI 由共享 seed 各端本地跑（近似一致），房主再用快照校正抹平跨引擎浮点残差。
- **名次/成绩 = 房主权威**：完赛判定、最终名次、完赛时间都以房主为准广播，避免两端各算差几毫秒。
- **确定性定步长**：`NET_SIM_STEP=33ms`，AI + 远程真人都由 `GameManager.driveNetAiFixedStep` 按固定步长推进（不用引擎变 dt），消除变 dt 漂移；渲染用廉价位置插值（`netRenderLerp`）补 45fps vs 30 步/s 的顿挫。

**教训**：别追纯 lockstep 确定性。老实用房主权威校正，且**要校正所有可见量**（位置+横向+朝向+姿态速度），任何一个不校正都会分叉。

### 8.2 关键文件地图（`assets/scripts/net/` + 接入点）

| 文件 | 职责 |
|---|---|
| `net/INetRoom.ts` | 联机抽象接口（login/createRoom/joinRoom/startGame/uploadFrame/broadcast/leaveRoom/setCallbacks…）。游戏只认这个接口。 |
| `net/WechatGameRoom.ts` | 微信实现（`wx.getGameServerManager()`）。所有微信坑都在这里。 |
| `net/DefaultNetRoom.ts` | 编辑器/web 桩，`isSupported()=false`，方法 no-op/reject。 |
| `net/NetManager.ts` | 工厂，按平台选实现。 |
| `net/NetRaceSession.ts` | 开局握手数据（seed + roster + localIsHost + localPos），`setNetRaceSession`/`consumeNetRaceSession`。 |
| `net/NetRaceController.ts` | **赛中核心**：每逻辑帧 uploadFrame（输入+自位置）、onSyncFrame 解析、房主迁移、快照/名次广播、赛内调试 HUD。 |
| `net/NetRaceInput.ts` | 每帧输入编解码，格式 `<pos>|<events>|<selfPos>`。 |
| `net/NetRaceSnapshot.ts` | 房主权威快照 `S|`（含每泳道 距离/横向/完赛/朝向/**速度**）。 |
| `net/NetRaceResult.ts` | 最终名次 `R|`。 |
| `net/NetLanePlan.ts` | 确定性泳道分配（按 posNum 升序→lane），各端一致。 |
| `net/NetInputCapture.ts` | 被动输入 sink，默认关，联机才开。 |
| `net/NetSwimmerLook.ts` | 按 avatarId 取稳定形象（各端看同一个人长一样）。 |
| `entity/RemoteSwimmerController.ts` | 远程真人泳者=复用 AI 身体，回放解码输入驱动 handleStroke/Kick/Dive。 |
| `ui/RoomFlow.ts` | 房间大厅 UI + 开赛握手 + 会话生命周期。**房间相关坑都在这里。** |
| `app/LoginManager.ts` | 邀请拉起/冷启动/热启动 onShow、openRoom/exitRoom。 |
| `core/GameManager.ts` | `updateNetRaceSync`（校正循环）、`driveNetAiFixedStep`（定步长）、`wireRemoteSwimmers`（远程真人接线）、`buildLocalSelfSnapshot`。 |

### 8.3 ★★会话生命周期 = 保活模型（最大的坑，务必理解）

**微信房间严格「一房一局」**：`endGame` 后房间进入 `roomState=3(gameEnd)`，**同房间再也无法 startGame**——真机双端实测铁证：owner 第二次 startGame 返回假 `ok`（roomState 仍卡 3、游戏没真开），member 返回 `errCode 4014 "game already started"`。

因此**「再来一局」不能用 endGame + 重新 startGame**。我们的解法是**保活单一会话（keep-alive）**：

- 一局结束**不调 endGame**，会话靠服务器 heartBeat 保活（`roomState` 停在 running）。
- 首局：正常握手（广播 seed → 各端 startGame → onGameStart → 进场）。
- 再来一局（`_reconnect=true`）：**不 createRoom/join、不 endGame、不 startGame**，直接复用运行中的会话——房主广播新 seed 后**直接 enterNetRace**，访客收到广播也直接进。
- `RoomFlow._reconnect` 只影响 `setupNet`（复用房+不 endGame），首局走 startGame 握手、再来一局走 direct-enter。

> **血泪教训**：曾经因为看到官方 demo 调 endGame（demo 是「一房一局，再来一局重新 createRoom + 重新邀请」），一度改成调 endGame，结果第二局房主进了「幻影比赛」、朋友卡「等待房主」。**demo 的一房一局意味着再来一局要重新建房+重新邀请，UX 差；保活模型才是「同一批人连续玩」的正解。别再改回 endGame。**

### 8.4 微信 GameServerManager 硬事实清单（全是坑）

1. **`onGameStart` 不可靠**：官方 demo 自己都有此 bug。startGame 返回 `ok` 但 onGameStart 有时不触发。**别只依赖它**，用多信号：`onGameStart` + `onRoomInfoChange` 的 roomState + `getRoomInfo` 轮询 roomState + startGame success 兜底，`handleGameStarted` 用 `_gameStartNotified` 保证只触发一次。
2. **`roomState` 值**：1=inTeam(大厅) / 2=gameStart / 3=gameEnd / 4=roomDestroy / **5=running**。`isGameStartedRoomState(s)=s===2||s===5`。
3. **`getRoomInfo` 轮询有时返回 `roomState=undefined`**（尤其刚 startGame 后）——所以不能只靠轮询，见上。
4. **所有人（含房主）都要调 startGame**：官方 demo `onBroadcast → startGame()`，房主也调。曾经只让访客调、房主靠被动检测 → 房主卡「开始中」（roomState=undefined 检测不到）。**房主也调 startGame，用它的 success 当兜底进场信号。**
5. **`accessInfo`（join 令牌，长串）≠ `roomIdStr`（房间号，20位数字，展示用）**：`getRoomInfo`/`onRoomInfoChange` 的 roomInfo **只有 roomIdStr、没有 accessInfo**。joinRoom 必须用 accessInfo，用 roomIdStr 会 `errCode 4003`。**分享 query 用 accessInfo，UI 展示房间号用 roomIdStr。二者绝不能互相回退。**
6. **`getRoomInfo` 不支持 Promise**，必须 success/fail 回调（很多 GSM API 都这样：startGame/updateReadyStatus/joinRoom/createRoom/leaveRoom）。我们统一包成 Promise。
7. **joinRoom 返回不含名单**（只 `{myPos, clientId}`），完整名单来自 `onRoomInfoChange`。别用 join 返回覆盖已有名单。
8. **GameServerManager 事件必须 `login()` 之后再注册**：全新设备上 login 前 `gsm.onXxx` 会抛 `undefined is not an object (this.emitter.on)`。`WechatGameRoom` 里 `_loggedIn` 后才 bindEvents。
9. **帧事件是「追加」监听不是替换**：裸重绑会叠加 → 每帧处理两遍。用 `offSyncFrame/offDisconnect` 精确解绑（存下回调引用）。
10. **房主退出用 `ownerLeaveRoom({assignToMinPosNum:true})`**，访客用 `memberLeaveRoom`。房主用 member 版退→别人还看得到房主。
11. **★★iOS 高性能模式与帧同步不兼容**：`game.json "iOSHighPerformance":true` 会让 iOS 建不出帧同步 Worker（`createWXLibWorker is not a function`）→ `nativeInstance.uploadFrame` undefined、onSyncFrame 永不来。**联机必须关闭 iOS 高性能模式**（构建面板取消勾选，别只手改 build/game.json）。安卓不受影响。
12. **`game.json lockStepOptions`** 由 `extensions/wechat-race-subpackage/hooks.js` 构建期注入（`gameTick:33, heartBeatTick:2000, offlineTimeLength:60000, UDPReliabilityStrategy:5, dataType:'String'`）。**改 hooks.js 要重载扩展 + 重 Build**，别手改 build 目录（重 Build 会覆盖）。
13. **必须体验版联调**：真机调试分享出去的是开发版，好友打不开（`Load Subpackage failed: path: music`）。双方都用体验版。
14. **热启动邀请走 `wx.onShow`**：游戏已运行时点分享卡，不走启动（onLoad 不再执行），新 query 给 onShow。`IPlatform.onAppShow` 处理。冷启动才走 `getLaunchQuery`。

### 8.5 传输通道：帧 vs 广播（可靠性不同）

- **帧通道**（`uploadFrame`/`onSyncFrame`）：UDP + 冗余（`UDPReliabilityStrategy`=每次下发的总帧数）。**相对可靠**（有冗余重发）。**真人的输入 + 自位置都走这条**（`buildLocalSelfSnapshot` piggyback 到每帧 uploadFrame）。
- **广播通道**（`broadcastInRoom`/`onBroadcast`）：**尽力而为，会丢包**（「时好时坏」）。房主 AI 快照 `S|`、开赛 seed、GO 倒计时、退出 `Q|`、名次 `R|` 走这条。丢了各有兜底（名次 4s 超时回退本地、GO 7s 兜底、AI 定步长自跑）。
- **教训**：需要稳的（真人位置）走帧通道；广播只放「丢了能兜底」的。曾经真人位置走广播 → 「时好时坏」，改走帧通道才稳。
- **跨网络**：帧通道 UDP 在跨运营商/地区/严格 NAT 下可能几秒后掉；`offlineTimeLength` 别设太激进（默认 100s，我们 60s）。若跨网络完全同步不上，先看两端调试 HUD 的「帧收/快照收」定位哪条通道挂了。

### 8.6 位置 + 姿态同步（校正循环，`GameManager.updateNetRaceSync`）

- **门控**：`_state` 是 RACING/GLIDING/**DIVING** 才校正（DIVING 必须包含——否则本端玩家坐在跳台没输入时，远端泳者跳完滑行就冻住）。
- **本地玩家不校正**（跳过 `_playerLaneIndex`）：本地预测=真值，校正它会被房主 ~1RTT 滞后值拽回 →「走不动」。
- **真人泳道**：追 `selfSnapshot(lane)`（帧通道来的 owner 自位置，强 blend 0.4，远则 snap）。
- **AI 泳道**：追 `snapshotTargets`（房主 `S|`，blend 0.2/0.25）。
- **卡跳水冗余**：真人泳道若 owner 位置在前进（`distance>1m`）但本副本 `!isNetRacing` → `forceEnterRace`（DiveRelease 丢了/跳水 tween 卡住的兜底）。**两条分支（帧 self + S| 兜底）都要有这个冗余**。
- **姿态速度同步（踩水坑）**：踩水↔游泳切换原本由本地 `motor.currentSpeed` 驱动，而远程副本位置是校正的、速度是本地回放算的 → 解耦 → 「踩水姿态在前移」。**修法**：`NetSnapshotEntry` 加 `speed` 字段，远程副本的踩水混合用**同步来的 owner 速度**（`applyNetPoseSpeed`→`CartoonSwimmerRig.setTreadWaterSpeedOverride`），只覆盖踩水决策、手臂节奏仍由回放驱动。本地玩家不覆盖（override=-1 回退本地速度）。
- **碰撞**：联机保留碰撞手感，只在**追帧 snap 那一刻**（`netCatchingUp`，距上次 snap<400ms）把该泳者移出碰撞集，同步好时正常参与碰撞。

### 8.7 确定性房主迁移（房主掉线不卡死）

- 房主权威只是**校准**通道不是**驱动**，各端本地在跑，房主掉线只退化成本地模拟，不会「玩不了」。唯一硬卡点=赛前倒计时（GO 只房主发）→ client 加 7s GO 兜底。
- **迁移**：`NetRaceController.checkHostMigration`（每帧）——快照 `S|` 带 `hostPos`（发送者 seat）；client 若信任的房主静默 >`HOST_SILENCE_MS(2500)+localPos*800` 则自升房主；`onRoomInfoChange` 第二探测——信任的房主 seat 不在名单→最小 present seat 立即接管。冲突自愈（收到更低 seat 快照就降级）。
- **注意**：房主迁移是**游戏层概念**，微信不知道。所以「自升房主」不改变微信会话状态。

### 8.8 房间 UI / 邀请健壮性（RoomFlow / LoginManager 坑）

- **已在房间里点新邀请**：`handleAppShowInvite` 曾 `if(_roomFlow)return` 什么都不做→加不进好友房。改成：不同房则 `leaveRoom` 旧房→`.then(openRoom(新房))`（微信同时只能在一个房，必须先离再进）。同房用 `matchesRoom(accessInfo)` 判断忽略。
- **成员按 posNum 稳定排序**：微信 memberList 顺序不定→各端槽位不一致。自我识别优先按 posNum（两人可能 roll 到相同随机头像+昵称）。
- **访客防幻影进场**：进场必须 `_pendingSeed!=0`(收到真 seed 广播) **且** `_gameStartConfirmed`(游戏已开始)（`maybeEnterNetRace`）。否则 fresh-join 进保活房间会因陈旧 roomState=running 自动开赛。**别加「没种子也进场」的兜底**（会触发幻影进场）。
- **邀请分享**：`share({query:'room='+encodeURIComponent(accessInfo)})`。房间固定横屏 4 列布局（别用 view.getVisibleSize 自适应——分享时视口瞬切竖屏会卡成 2 列）。
- **房间不可用**：join 失败（房间解散/已开赛）→ `showRoomUnavailable('房间已解散或已开始比赛')`，别掉进假本地预览房显示原始报错。

### 8.9 性能坑（vConsole 极贵）

- **vConsole 打开时 `console.log` 极贵**（每条 DOM append + reflow）。热路径（每帧/每广播）的 log **必须门控或限流**：
  - `NetRaceController.onSyncFrame` 每帧输入 log → `NET_FRAME_LOG=false` 门控。
  - 调试 HUD 刷新 → `HUD_REPAINT_INTERVAL_MS=160` 限流（Label.string 重设会重建文字网格）。
  - `WechatGameRoom.onBroadcast` 跳过高频 S|/P| 日志。
- 正式发布 vConsole 是关的，这部分开销不存在——但真机联调开着 vConsole 会误判成「联机很卡」。**测性能先关 vConsole。**
- `driveNetAiFixedStep` 有 6 步上限防死亡螺旋；AI 姿态降频/裁剪在联机模式也跑（没绕过单机优化）。
- **「一方卡在开始中不上传帧」会拖累另一方**：帧同步每 tick 等所有参与者的帧，一个参与者 startGame 了却不上传帧（如卡大厅）→ 帧通道 stall → 对端空转变卡。根治=保证进了会话就进比赛并上传帧。

### 8.10 调试 HUD（赛内左上角）

`NetRaceController.attachHud` 显示：`房主/客户 pos=X 当前房主seat=X (已接管)` + `帧 发=X 收=Y | 快照 发=A 收=B | 名次 发=C 收=D` + 每泳道 本地 vs 房主距离。**联机排障第一眼看这里**：帧收不涨=帧通道挂；快照收不涨=广播挂；都涨但人不动=名单/lane 时序 bug。

### 8.11 已知限制 / 待办

- 跨网络（不同运营商/地区）帧通道 UDP 可能不稳，极端网络下同步不上是平台限制，非代码 bug（换网测对照）。
- 本地玩家零延迟预测→在对方屏上你被渲染成房主权威（你输入晚到房主）略靠后，两屏位置无法**完全**一致，这是混合模型的固有代价，名次权威保证公平。
- 匹配（陌生人 gamematch）、好友邀请（开放数据域）、断线补帧 `reconnect` 尚未接入（当前只有房间号邀请 + 好友房）。
- 养成货币/存档云端（CloudBase）延后，`IBackend` 已隔离，现用 MockBackend(localStorage)。

### 8.12 养成修饰同步（让养成在联机中生效，`RaceModifiers` + `NetRaceModifierCodec`）

> 目标：养成（等级/角色带来的 balance 加成）在联机里要像单机一样发挥作用，且**后续新增的养成项要能低成本带进联机**。

- **★前提（务必理解）**：**联机对战中不升级**——玩家一旦进房，养成就**冻结**，整局（含 rematch 保活重开）都不变。所以「入房时」快照的养成档案在整个房间生命周期内**始终有效**，不存在陈旧/需要中途刷新的问题。这条前提是下面「用 roster extInfo 一次性传输」成立的基础。
- **为什么必须同步**：养成改的是玩家 balance（`maxSpeed/energyTotal/perfectComboMaxOvercap/strokeQualityAccel/kickMaxSpeed/diveMaxLaunchSpeed/`**`weight`**），全都**影响比赛结果**；`weight` 还进碰撞击退结算。若各端对同一泳者用不同 balance，本地预测和碰撞会算出不同结果。养成是**本地存档**，既不在共享 roster 里，也无法从 `avatarId` 推导 → 必须显式同步。
- **三层解耦架构**（加新养成只动前后两层的映射，中间传输层通用）：
  - **resolve**（`progression/RaceModifiers.ts`）：存档 → 极小 `RaceModifierDigest`（当前=`{characterId, level}`）；再由 `resolveModifiersFromDigest()` 用**共享角色配置 + 同一纯函数** digest → `RaceModifierProfile`（`{balance}`）。owner 端出 digest，各端**重新解析**出同一份 profile。
  - **transport**（`net/NetRaceModifierCodec.ts` + `RoomFlow`）：只传 **digest** `"<characterId>,<level>"`（几字节）。大厅里各端把自己的 digest 广播出去（`MOD|<pos>|<payload>`），**房主收集**成一张按 seat 的表；**开赛时房主把整张表连同 seed 塞进同一条 start 广播**（`{t:'start',seed,mods:{pos:payload}}`），各端 `mergeBroadcastModifiers` 采纳后并入 `NetRaceMember.modifiersBlob`。
  - **apply**（`applyRaceModifiersToMotor`）：本地玩家（`GameManager.applyPlayerProgression`）与每个远端人类（`GameManager.wireRemoteSwimmers`，`resolveModifiersFromDigest(decodeModifierDigest(blob))`）走**同一个 seam** → 养成对联机的作用与单机一致。
- **★为什么传 digest 而不是解析后的 balance、为什么走广播而不是 extInfo（血泪坑）**：
  - **微信 `memberExtInfo` / `roomExtInfo` 硬上限 = 32 字节**（官方文档）。`avatarId|nickName` 本身就可能接近 32（中文昵称 3 字节/字），塞进 7 个量化浮点（~40 字节）→ **`createRoom` 直接 `errCode 4013 buffer overflow`，新版本建不了房**。所以 extInfo 只留 `avatarId|nickName`，养成**移出 extInfo**。
  - balance 是 `(角色, 等级)` 的**纯函数**，角色定义 + resolve 逻辑都是**各端共享代码** → 只需传最小 digest（角色 id + 等级），各端本地重解析即得同一份 balance。传 digest 而非浮点：① 小得多（绕开 32 字节坑）；② 更可扩展（未来养成加 key/id，不是加传输值）。
  - **★递送用「房主合并进 start 广播」而非各发各的（健壮性关键）**：digest 广播本身尽力而为、且和 seed 广播**赛跑**（访客可能先收到 seed 就进场，随后到的 digest 已晚）。所以不靠「每个人各自那条 digest 都送达」，而是**房主整局大厅收集好，开赛时和 seed 打包成一条 start 广播原子下发**。收益：① 消除 seed↔digest 赛跑（同一条消息）；② 消除逐 peer 丢包（只依赖 start 到达——而它本就是开赛必要条件，丢了根本开不了赛）；③ **各端用同一张表 = 每个泳者 balance 各端一致**（单一权威，不会 A 端收到 B 的、C 端没收到而分歧）。残余：房主自己没收全某人的 digest（大厅期间从没送达房主）→ 那人中性 balance，位置仍 owner 权威，自愈不崩。
- **进房即冻结**：联机中不升级，digest 一局不变；rematch 保活重开也用同一套广播刷新，无陈旧问题。
- **★weight 跨端一致 → 联机恢复「按体重加权」碰撞**：AI 的 weight 来自共享 roster（确定性一致），真人的 weight 由 digest 各端重解析一致 → 所有泳者 weight 各端一致，`resolveSwimmerCollisions` 联机也用**加权拆分**（不再需要早期 `uniform-weight` 权宜方案，已回退）。养成的「体重/撞飞抗性」在联机真正生效；残余跨引擎浮点差异由 owner/host 位置权威吸收，不会永久漂移。
- **加新养成项 = 追加式改动**：① 扩 `RaceModifierDigest` + `RaceModifierProfile`；② `resolveLocalModifierDigest` / `resolveModifiersFromDigest` 里映射；③ `applyRaceModifiersToMotor`（或新 apply 分支）里映射字段→泳者；④ 若需要独立线上字段再动 codec。传输层（`MOD|` 广播）通用无需改，自动带进联机。
- **坑**：
  - **别再把养成塞 `memberExtInfo`**（32 字节，和 `avatarId|nickName` 抢空间，必炸 4013）。静态每局数据走广播。
  - `MOD|` 是广播裸串（非 JSON）→ `RoomFlow.handleBroadcast` 要在 JSON 判断**之前**先认 `MOD|` 收集，别被「只处理 `{...}`」的早返回吞掉。
  - digest 各端**重新解析**：跨引擎浮点在 balance 上有末位差异，但只影响碰撞权重/预测的极小量，由位置权威吸收；若要严格一致可对重解析值同样量化取整。


