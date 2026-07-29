# 联机与养成 · 落地清单（Backlog）

这是「实时对战 + 养成 + 商业化」的**实现待办清单**，按阶段排列，可逐条慢慢做。
设计原理不在这里重复，看对应设计文档：
- 联机/帧同步：[realtime-multiplayer-notes.zh.md](realtime-multiplayer-notes.zh.md)
- 后端/养成：[backend-and-progression-architecture.zh.md](backend-and-progression-architecture.zh.md)
- 平台能力抽象：`assets/scripts/platform/`（代码内注释）

状态图例：✅ 已完成 · 🔲 待做 · ⏸ 依赖前置 · （可选）非必须

---

## 阶段 0 · 已完成（地基）

- ✅ **确定性随机 `SharedRNG`**：`assets/scripts/core/SharedRNG.ts`；AI/赛道/名单随机全部改走种子流。为帧同步铺路（同 seed + 同输入 = 各端一致）。
- ✅ **平台抽象层 `platform/`**：`IPlatform` + 微信/抖音/默认实现 + `PlatformManager`（按 `cc/env` 编译期常量选实现）。
- ✅ **登录接入**：`PlatformSession.ensureLogin()`，进入 Login 场景即登录；编辑器/Web 走 mock 不崩。

---

## 阶段 1 · 养成后端（第一阶段核心，先做这个）

目标：每账号云端养成，换设备不丢；看广告得金币跑通。后端 = 微信云开发（CloudBase）。

### 1A 云端准备（在微信开发者工具里做，非本仓库代码）
- 🔲 开通「云开发」，创建环境，记下环境 ID。
- 🔲 建云数据库集合 `players`（结构见后端设计文档第 4 节）。
- 🔲 仓库根建 `cloud/functions/` 放云函数 Node 代码（不进 Cocos 工程）。

### 1B 客户端 backend 抽象层（本仓库代码）
- 🔲 `assets/scripts/backend/IBackend.ts`：接口 `loadProfile / grantAdReward / saveProgress`（+ 可选 `submitScore`）。
- 🔲 `assets/scripts/backend/PlayerProfile.ts`：养成数据结构（coins/level/unlocks/daily…）。
- 🔲 `assets/scripts/backend/WechatCloudBackend.ts`：用 `wx.cloud.callFunction` 实现（`declare const wx`）。
- 🔲 `assets/scripts/backend/MockBackend.ts`：编辑器/Web 用 `sys.localStorage` 模拟，本地可调试。
- 🔲 `assets/scripts/backend/BackendManager.ts`：工厂，按 `cc/env` 的 `WECHAT` 选实现（同 platform 套路）。
- 🔲 `assets/scripts/backend/PlayerData.ts`：养成单一入口（单例）。内存值 + 本地缓存；`load()` 启动拉取；写操作走 backend、以返回值为准。

### 1C 云函数（Node.js，放 `cloud/functions/`）
- 🔲 `loadProfile`：读 `OPENID` → 查/建 `players` 文档 → 返回 profile。
- 🔲 `grantAdReward`：校验每日上限 → 原子 `inc(coins)` → 返回新余额+adCount。
- 🔲 （可选）`saveProgress`：白名单字段保存（拒绝敏感字段）。

### 1D 接入游戏
- 🔲 启动流程调 `PlayerData.load()`（Login 场景，login 之后）。
- 🔲 界面显示金币（先放个简单文字/角标）。
- 🔲 加一个**独立「看广告得金币」测试按钮**：`showRewardedAd → 'completed' → grantAdReward → 刷新金币`。
- 🔲 本地缓存：启动先显示缓存值，云端返回后覆盖。

---

## 阶段 2 · 好友实时对战（微信托管，先 2 人房）

目标：借助微信 `GameServerManager` 跑通好友对战，不自建实时服务器。

### 2A net 抽象层
- 🔲 `assets/scripts/net/INetRoom.ts`：`createRoom/joinRoom/startGame/uploadFrame/onSyncFrame/reconnect/leave` + 事件。
- 🔲 `assets/scripts/net/WechatGameRoom.ts`：用 `wx.getGameServerManager()` 实现（房间/帧同步/补帧）。
- 🔲 `assets/scripts/net/NetManager.ts`：工厂（按 `cc/env` 选实现）。

### 2B 帧同步接入（依赖确定性，SharedRNG 已就绪）
- ⏸ **固定逻辑步**：把比赛 `update` 改成「每个 `onSyncFrame` 推进一个固定逻辑帧」（微信帧节拍驱动）。
- ⏸ **输入帧化**：玩家左右划水 → `uploadFrame`；`onSyncFrame` 里应用全房间输入。
- ⏸ **开局种子**：房主 `broadcastInRoom` 发 seed → 各端 `reseedSharedRandom`。
- 🔲 好友房：房间号手动加入，先不做匹配。跑通「2 人同屏一致游完一局」。

### 2C 稳定性
- 🔲 断线：`onDisconnect → reconnect`，补帧（`onSyncFrame` 回放旧帧要按服务端推进，别丢）。
- 🔲 退出/超时处理，房主离开销毁房间。

### 2D 构建配置
- 🔲 `game.json` 加 `lockStepOptions`（`gameTick`/冗余帧等），通过 `extensions/` 构建扩展注入，别手改导出目录。

### 2E 成绩 / 排行榜（用微信 RankManager，免服务器）
- 🔲 MP 后台配「玩法 ID」：游泳「最快完成时间」用**时间型** scoreKey（如 `race_best_time`）。
- 🔲 结算调 `wx.getRankManager().update({scoreKey, score})` 上报最快成绩。
- 🔲 展示：`getScore({periodType:4})` 拿历史最好；好友榜展示走开放数据域（后做）。

---

## 阶段 3 · 匹配 + 加固（可选，联机稳定后）

- 🔲 对局匹配：后台 `createMatchRule` 申请 matchId（设 `need_room_service=1` 匹配完自动建房）+ `setMatchIdOpenState` 打开 → 客户端 `startMatch/onMatch`。
- 🔲 好友邀请（体验升级）：`startStateService` + 开放数据域 `getFriendsStateData`/`inviteFriend` + 游戏域 `onInvite`（需子域 + postMessage）。
- 🔲 结算奖励落云端：对局结束由云函数发金币/经验（不由客户端加）。
- （可选）🔲 激励视频**服务器回调**防作弊（HTTP 云函数接微信签名回调，真看完才发奖）。
- （可选）🔲 好友排行榜可视化：开放数据域渲染（数据由 RankManager 统一维护）。
- （可选）🔲 帧回放/校验：后台 `getgameframe` 复算成绩。

---

## 关键约束（落地时别忘）

- **资源增减一律走云函数**（原子自增），客户端只发「意图」，真值以返回为准。别让客户端 `set` 整个存档回云端。
- **账号 = openid**，云函数从上下文取，不信客户端传的 id。
- **appsecret / 云密钥只在云端**，绝不进客户端包。
- **改 `.ts` 后跑类型检查**：`npx.cmd --yes --package typescript@5.4.5 tsc --noEmit --ignoreDeprecations 5.0 --skipLibCheck`；并留意编辑工具可能把文件行尾翻成 CRLF（改完 `git diff --numstat` 看是否整文件重写）。
- 新目录 `backend/`、`net/` 延续 `platform/` 的「接口 + 平台实现 + mock + 工厂」套路，游戏逻辑只认接口。

---

## 建议动手顺序

1. 阶段 1B + 1D 的 **MockBackend 版**：先不碰云，用 `localStorage` 把 `PlayerData` + 金币显示 + 看广告按钮跑通（编辑器就能测）。
2. 再做 1A + 1C + `WechatCloudBackend`：把 mock 换成真云函数，验证换设备存档还在。
3. 之后进入阶段 2 的好友对战。

> 这样每一步都能独立验证、可回退，理解成本也低。
