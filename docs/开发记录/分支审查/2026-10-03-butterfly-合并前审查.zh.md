# butterfly 分支合并前审查报告

审查日期：2026-10-03。本文保留初始审查快照与总体取舍；用户已授权优先整合影响小、无冲突的独立内容，首批范围与验证见 [第一批低风险整合记录](2026-10-03-butterfly-第一批低风险整合.zh.md)。互相依赖的玩法、动作、数值、云端及联机整合仍按后续批次处理。

用户已明确整合原则：根据功能做适当重构后纳入，以主干最近的性能优化和云端逻辑为基础。此原则优先于分支原实现；具体功能取舍仍按第 8 节确认。

## 1. 结论与建议方案

**以最新 main 为基础，按功能迁移并进行必要重构后纳入。** 娱乐玩法、自由泳动作、离线蝶泳和平台工具有保留价值，但分支与主线已经明显分叉。必须先处理云端娱乐开赛、联机范围隔离和主线行为保留，才能得到可用的整合版本。不能把解决 Git 冲突当作完成整合。

推荐本次范围：

1. 纳入娱乐模式的玩法、AI、恢复、表现及配套联机；补齐主线云端的娱乐开赛和结算适配。
2. 纳入自由泳转体／抬肘动作，保留 main 已确认的 0.8 划水节奏与碰撞恢复。
3. 纳入离线蝶泳，按分支现状覆盖本地标准、狂野、娱乐和 AI 调试；房间和联机继续禁用。蝶泳踢腿衔接实验继续关闭。
4. 纳入 TapTap 构建工具、隔离诊断脚本和最新交接记录；纳入抖音打包、侧边栏和埋点。平台状态按实际验收记录保留。
5. 尾迹跟游代码可纳入，**推荐本次默认先关闭**，待确认其改变狂野／娱乐体力平衡后再启用。
6. **暂缓每日补给、突破宝石、突破升级及关联经济 UI**。需要与新的云端事务、存档迁移和奖励规则一起单独整合。
7. main 的新角色、生涯与 Boss、教学、云后台／环境隔离、CDN／分包／图集和性能优化继续保留。`art/` 源稿、历史预览及生成产物不重新纳入 Git 跟踪。

本报告中的“建议纳入”包含解决其依赖和冲突，不表示可以原样复制对应文件。169 个提交中有大量相互依赖的修复，不建议靠零散 cherry-pick 组装。

实施约束：

- main 的性能设计是新增功能必须遵守的基线：保留热路径优化、UI 按变化写入、采样限频、对象复用、资源加载及分包策略；新玩法的表现与更新入口要按这些规则接入。
- main 的云端逻辑是持久化行为的唯一接入基础：沿用后台抽象、权威票据／结算、事务、幂等、版本兼容和环境隔离；按新增功能扩展，不用本地 Mock 替代微信端云逻辑。
- 迁移分支经过修复的功能行为和验证用例，同时调整实现边界。`GameManager` 保持编排；娱乐生命周期与系统接入放入专门模块，运动与资源消耗归泳者／物理模块，镜头和 UI 各自管理生命周期。
- 每个功能先验证 main 原有行为，再验证新增行为及组合。分支单独通过的检查只能作为参考，最终依据是重构后的整合分支。
- 重构围绕新功能的接入与明确的性能／云端问题展开，避免扩大到无关系统。

## 2. 固定快照与审查方法

| 项目 | 固定值 |
| --- | --- |
| 主仓库 | `/Users/abao/Documents/GitHub/swimming` |
| 目标 main | `777aa45172734f32c7b86b154eb9e764c9419869` |
| 来源分支 | `feature/butterfly-debug` |
| 来源提交 | `e5dca0327ed8d5e70bf5f38d39489022491e8e4b` |
| 共同基点 | `69e58d162f72c6347161ea0f4e9bd8f625b88ac3` |
| 两边独有提交 | main 23 个；feature 169 个 |
| feature 相对基点 | 861 个文件，新增 96,465 行，删除 1,333 行 |
| 合并预演 | 69 个冲突文件，详见附录 |

快照与本地已有远端跟踪引用一致；本次未联网刷新远端。861 个文件已按功能分类，重点检查玩法、动作、数值、联机、后台、UI 热路径、资源和构建调用链，并运行分支离线检查。供应商插件和美术产物侧重依赖、资源与构建审计。

审查在独立工作树及临时 clone 中进行。`merge-tree --write-tree` 只在临时 clone 中预演，未改变主工作区的分支、索引或合并状态。下面分支证据链接指向本机审查工作树；内容以以上提交为准。

主要依据：仓库 `AGENTS.md`、共享动作技能、UI／动效技能、联机同步说明第 8 节及现有主线规则。

## 3. 合并取舍表

| 内容 | 分支实际范围 | 建议 | 纳入条件 |
| --- | --- | --- | --- |
| 娱乐模式 | 200／400 米、五档整局强度、事件排期、背景障碍／补给、AI、恢复及结算接入 | 纳入 | 修复云端开赛；与配套协议、恢复和表现同批整合 |
| 娱乐事件 | 心跳苏打、定时水球、漩涡、水上障碍、玩具冲撞、水球点名、杂物、海龟班车、喷泉、巨浪 | 纳入 | 采用最终实现和后续修复；不是每局同时运行全部事件 |
| 娱乐联机 | 每局身份、事件序列去重、可靠命中、快照／恢复、房主迁移、结果处理 | 纳入 | 保留 main 的云数据范围门禁；统一新协议版本 |
| 自由泳动作 | 身体转动、换气及抬肘，正式比赛／AI／远端真人姿态入口 | 纳入 | 与 main 角色、0.8 节奏、特殊姿态和水花合并验证 |
| 蝶泳 | 双手按住进入；双臂资源与心率；GOOD／PERFECT；受撞、转身、长帧和恢复处理 | 纳入离线范围 | 联机／房间禁用；确认本地正式玩法开放范围 |
| 蝶泳踢腿衔接 | `kickCarryScale=0`，持续参数 0.3 秒 | 保持关闭 | 不因合并启用实验参数 |
| 尾迹跟游 | 狂野／娱乐跟游，15% 体力节省，带联机权威来源和表现 | 代码可纳入，推荐默认关闭 | 用户确认是否接受体力平衡变化 |
| 基础角色／技能数值 | 部分仍是主线调整前的旧值 | 以 main 为准 | 仅增量加入蝶泳、娱乐、跟游参数 |
| 每日补给 | 每日免费 100 金币、广告 1 宝石、广告 200 金币；北京时间 05:00 换日 | 本次暂缓 | 补齐云端事务、可信广告验证、幂等、跨端／跨日处理 |
| 突破养成 | 5／10／15／20／25 级关卡，下次升级额外需 1／2／3／4／5 宝石 | 本次暂缓 | 新存档版本、迁移、云端升级和生涯宝石奖励同时完成 |
| TapTap | 转换插件、构建顺序桥接、WebGL 配置、事件／字体／启动诊断 | 纳入工具与记录 | 平台配置隔离；缺字、偶发黑屏和 TapDB 未完成状态保留 |
| 抖音 | BYTEDANCE 门控、启动来源、侧边栏引导与复访、基础埋点、测试构建 | 纳入 | 保留测试标记；正式发布前另验广告、复访、包体与双端性能 |
| 运行时资产 | 新事件资源、图标、模型与音效等 | 按实际功能纳入 | 保留 UUID／`.meta`；延续 main 分包、CDN 和图集路径 |
| 字体 | 两个 TTF、字表和清单均有冲突 | 合并文案后重新生成 | 使用 `fonts:build`／`fonts:check`，不直接选一边二进制 |
| `art/` 和历史产物 | 基点差异中 215 个 art 文件；分支共跟踪约 50.09 MiB 的 art 文件 | 不重新跟踪 | 本地原稿保留；有复用价值的制作脚本按主线目录另行整理 |
| 文档 | 新玩法说明、平台交接；部分旧文档与 main 的目录整理冲突 | 整合 | 按 main 目录放置，保留最新状态和证据，避免两份相互矛盾的方案 |

## 4. 必须解决的集成问题

### F1 · 高优先级：保留 main 云后台后，娱乐模式无法从正式入口开赛

触发：快速比赛选择娱乐模式，沿分支入口调用 `PlayerData.executeCareer({type:'begin', rule:'entertainment', ...})`。

分支 `CareerPrototypePanel` 的正式入口会申请比赛票据，分支本地 `CareerRules` 接受娱乐规则；main 微信端使用 `WechatCloudBackend`，而 `cloud/src/service.cjs` 的开赛校验仅接受 `standard` 和 `wild`。保留云后台、只合入客户端娱乐入口会返回“比赛参数无效”，无法开赛。

已使用 main 的真实云服务、规则及现有内存数据库夹具复现，未连接线上：同一格式的新账号请求中，`standard` 成功；`entertainment` 返回 `ok=false, code=INPUT, message=比赛参数无效`。

处理：在主线云规则中明确接入娱乐票据、AI 配置、奖励及结算，保留 main 生涯／Boss 规则和历史票据兼容。同步经济规则版本与版本入口。客户端和云端应同时具备对应规则；不能通过把微信端退回 MockBackend 来让入口可用。

证据：[分支正式开赛入口](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/ui/CareerPrototypePanel.ts:208)、[分支规则校验](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/progression/CareerRules.ts:100)、[主线云校验](/Users/abao/Documents/GitHub/swimming/cloud/src/service.cjs:153)、[主线后台选择](/Users/abao/Documents/GitHub/swimming/assets/scripts/backend/BackendManager.ts:14)。

### F2 · 高优先级：每日补给与突破接口缺云实现，且两边的 schema=7 含义不同

分支新增 `claimDailyShopReward`、`adjustDebugCurrency`、`breakthroughCharacter`，并在商店／升级入口实际调用。main `WechatCloudBackend` 未实现这些接口，仍是旧 `grantDebugCoins` 形态；云服务也没有每日补给与突破事务。直接保留双方接口和实现会出现类型契约不满足；绕过类型检查仍会遇到方法缺失。

存档问题更具体：main 的 schema 7 包含教学状态和逐角色外观；分支的 schema 7 包含突破宝石、每日补给和突破次数。版本号相同不能证明结构兼容。

已用主线默认档案构造一个 15 级模拟角色，再调用分支 `normalizeProfile`：等级仍为 15，但 `breakthroughCount=0`，输出不再包含 `tutorialCompleted` 和 `characterAppearances`。分支迁移按 `sourceSchema < 7` 判断历史突破，主线 schema 7 不会走该分支。该复现只操作内存模拟数据，没有读取或改写真实玩家存档。

处理：推荐本次整体暂缓这批经济改动，包括调用它们的 UI。若用户要求本次纳入，必须定义新的统一存档版本，兼容两种历史结构，保留外观／教学／角色等级／票据，完成服务端奖励、升级、突破、广告验证及幂等；历史宝石补偿规则需要明确。不要在客户端用分支归一化函数覆盖云档。

证据：[新后台接口](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/backend/IBackend.ts:95)、[商店领取调用](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/ui/ShopDailySupplyPanel.ts:273)、[突破升级调用](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/progression/ProgressionManager.ts:118)、[分支存档迁移](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/backend/PlayerProfile.ts:167)、[主线云后台](/Users/abao/Documents/GitHub/swimming/assets/scripts/backend/WechatCloudBackend.ts:313)、[主线外观迁移](/Users/abao/Documents/GitHub/swimming/assets/scripts/backend/PlayerProfile.ts:218)。

### F3 · 高优先级：联机协议必须同时保留云环境范围隔离和娱乐同步

main 协议 53 的 `PV|` 握手携带云环境、存储命名空间和经济规则版本组成的 `NET_ROOM_SCOPE`，房间开赛也检查对应范围。分支协议 130 的握手只携带席位和版本，缺少这条主线新规则。

如果冲突直接采用分支的协议／房间文件，开发和正式数据范围隔离会回退；直接采用 main 则会丢失娱乐同步字段。130 和 53 是独立演进的编号，大小不能表示功能包含关系。

处理：合并 `NetRaceProtocol`、`RoomFlow`、开赛消息及同步消费链；保留 scope 校验、新增娱乐数据、每局身份和序列去重，使用统一的新协议版本。验证旧 main、旧 feature 及不同 scope 客户端均不能混房；同版本同 scope 正常开赛、重赛和房主迁移。保活房间逻辑继续保留，重赛不调用 `endGame`。

证据：[主线范围与握手](/Users/abao/Documents/GitHub/swimming/assets/scripts/net/NetRaceProtocol.ts:45)、[主线兼容校验](/Users/abao/Documents/GitHub/swimming/assets/scripts/net/NetRaceProtocol.ts:113)、[分支协议及握手](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/net/NetRaceProtocol.ts:117)。

### F4 · 高优先级：整文件采用分支配置会撤销主线最近的平衡和恢复调整

这些差异已与共同基点比较：下面七项在 feature 中仍等于基点，是 main 后续改过，而非 feature 新提出了一轮替代平衡。

| 参数 | main | feature／基点 | 建议 |
| --- | ---: | ---: | --- |
| `motion.heldMotionSpeedScale` | 0.8 | 1 | 保留 0.8 |
| `ability.chainSpeedPerStack` | 0.017 | 0.02 | 保留 main |
| `ability.frogPerfectReward` | 0.9 | 0.8 | 保留 main |
| `ability.legKickAcceleration` | 1.15 | 1.4 | 保留 main |
| `ability.legKickSpeed` | 1.03 | 1.15 | 保留 main |
| `ability.legStrokePower` | 0.9 | 0.85 | 保留 main |
| `ability.ninjaPerfectReward` | 1.25 | 1.35 | 保留 main |

main 另有四个踢水脱困参数，feature 配置缺失：`collision.kickEscapeSpeed=0.9`、`kickHeadOnPenaltyScale=0.4`、`kickRecoveryHoldSeconds=0.45`、`kickRecoveryRate=2`。相应运动层／AI／同步行为也必须保留，不能只保留 JSON 键。

feature 新增 105 个 main 配置中没有的调参键，需要随所选功能加入并检查默认值。`tuning.version` 的 main 52 和 feature 62 不是统一时间线，不能按版本数字选整份配置。

处理：在 main 的角色、技能、AI 与碰撞恢复基础上增量添加新参数。保留第 12 个角色及主线成长／生涯／Boss 重平衡。合并后重跑平衡基准，不把分支旧 11 角色的通过结果当作新名册验收。

证据：[主线配置](/Users/abao/Documents/GitHub/swimming/assets/resources/config/tuning.json)、[分支配置](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/resources/config/tuning.json)、[主线平衡记录](/Users/abao/Documents/GitHub/swimming/docs/开发记录/数值与功能/慢节奏角色平衡与AI验证.zh.md)。

### F5 · 中优先级：构建、字体与资源需按 main 当前布局整合

main 最近加入云／CDN、分包、UI 图集与加载优化，feature 的旧 hook、`ResourcePaths` 或构建配置不能整体覆盖。这里属于冲突解决时的回退风险，不是分支主动删除这些新功能。

处理：微信继续保留 main 的首包限制、纹理／mip 审计、CDN 及资源路径。TapTap 转换必须在资源审计之后运行；抖音启动脚本仅在对应平台注入。不得将全项目默认发布目标改为 TapTap，或让抖音／TapTap 误走微信云与微信专属资源加载。

字体必须扫描最终静态文案重新生成并检查。新资产保留 `.meta`；同名资源保留 main 现有 UUID。分支运行时原始资源体积不能换算成实际微信首包大小，需要合并后的真实构建审计。

main 已停止跟踪并忽略 `art/`；分支差异中的制作稿、历史图和归档不应重新添加。用户此前恢复为忽略状态的本地文件继续保留，合并中遇到同名本地文件须先核对和备份，不能用强制检出解决。

证据：[分支 TapTap 构建桥接](/Users/abao/.codex/worktrees/butterfly-review/swimming/extensions/wechat-race-subpackage/taptap-build-bridge.js:23)、[主线构建 hook](/Users/abao/Documents/GitHub/swimming/extensions/wechat-race-subpackage/hooks.js)、[主线资源路径](/Users/abao/Documents/GitHub/swimming/assets/scripts/core/ResourcePaths.ts)。

## 5. 动作、玩法与性能评价

蝶泳并非只在独立调试页生效。`resolveButterflyAvailability` 对本地 `race` 和 `ai-debug` 返回开启，网络／房间返回关闭。分支在正式标准、狂野和娱乐规则中都有对应回归。双手输入、双臂计费、心率／蓄气、恢复锁、受撞取消和长帧推进已形成完整调用链，建议纳入离线玩法；需要用户确认这个开放范围。

自由泳转体／抬肘属于姿态修改，但已经推广到比赛、AI 和远端真人。应合并到 main 当前角色与动作入口，保留特殊动作、碰撞和轴向姿态门控。离线模型测试覆盖关节与恢复，合并到 0.8 节奏、第 12 角色后仍需检查肩肘、换气、转身、水花及远端姿态。

尾迹跟游会改变结果相关资源，不是纯装饰。分支默认开启，狂野／娱乐可节省 15% 划水体力；应让其权威状态和协议一起合并。推荐先关闭玩法开关，避免本次隐式改变已确认的狂野平衡。

娱乐编排和计划使用 `SeededRandom`；新增事件配有主机驱动、快照、可靠命中、重开与恢复检查。整合时继续使用主线权威模型，不能改为各端自行随机判定结果。蝶泳联机没有在本次审查中获得开放依据。

表现层已有有效成本控制：共享事件镜头使用 256×144 RenderTexture 和 30Hz 上限；娱乐水花池固定容量，几何／材质建立一次，以 20Hz 更新；多处标签和节点按变化写入。高档娱乐仍增加额外镜头、透明层、模型和特效，需要微信 iOS 真机评估 draw call、填充率和峰值分配。

`SwimmerNameOverlay` 虽对眩晕表现采样限频，整体名字投影、避让和位置／尺度计算仍按比赛更新运行。这属于性能审查项，目前没有真机证据证明掉帧。合并时保留 main 热路径优化，检查 `GameManager.update()` 下的标签、Graphics、变换、Tween 和分配。

`GameManager` 相对基点新增 3,582 行、删除 171 行，娱乐初始化和细节明显集中。建议整合时将独立编排／接入逻辑移入专门模块，控制后续维护成本；这是结构建议，不是已复现的运行错误。

证据：[蝶泳开关](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/ButterflyAvailability.ts:4)、[自由泳动作](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/character/FreestyleBodyRollMotion.ts)、[跟游规则](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/swimmer/DraftingRules.ts:2)、[娱乐水花池](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/EntertainmentWaterSplash.ts:76)、[名牌更新](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/ui/SwimmerNameOverlay.ts:315)。

## 6. TapTap 与抖音的实际完成状态

**TapTap：可合入构建成果，但不能判定可正式发布。** 分支插件为 1.2.2；转换桥接采用暂定 20 MB ZIP 保守预算，最终限制仍由平台上传校验。基础事件清单标记 `local_only`、远程注册未验证。最新交接记录明确：0.0.12 真机仍缺字；一次进入大厅成功不能关闭偶发黑屏问题；TapDB 权限／标识待确认。GPU 字体补传只是独立诊断实验，用户仍反馈缺字，不应推广到正常跨平台字体逻辑。

**抖音：平台隔离实现可纳入，保留测试阶段状态。** `BYTEDANCE` 门控使微信／网页不初始化该服务，埋点在状态边缘触发。侧边栏跳转成功不会伪造复访或自动发奖，超时与监听清理有测试覆盖。依据分支交接记录，六项基础事件及字段验证通过，真实 `sidebar_return` 仍待测试条件具备后验证。当前代码保留 `build_version=douyin-platform-test-2`、`is_test=1`；正式发布前需切换相应标记并核验真实广告位、双端、连续游玩和构建后的资源加载。

本次没有访问平台后台，也没有重新上传、发布或部署。上述真机／后台状态来自固定快照中的交接证据，不作为实时平台状态。

证据：[TapTap 最新交接](/Users/abao/.codex/worktrees/butterfly-review/swimming/docs/平台能力/TapTap小游戏发布与数据埋点落地计划.zh.md:525)、[TapTap 本地事件状态](/Users/abao/.codex/worktrees/butterfly-review/swimming/scripts/taptap-basic-events.json:4)、[抖音状态记录](/Users/abao/.codex/worktrees/butterfly-review/swimming/docs/平台能力/抖音小游戏发布与数据埋点落地计划.zh.md:15)、[平台门控及测试标记](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/platform/PlatformEngagement.ts:5)。

## 7. 验证结果与未通过项

下列结果针对 feature 固定快照，**不代表合并后的 main 已通过**。

| 检查 | 结果 |
| --- | --- |
| TypeScript 5.4.5，`--noEmit --ignoreDeprecations 5.0 --skipLibCheck` | 通过；使用现有 Cocos 生成声明 |
| 字体只读审计 | 通过；扫描 326 个文件，字集 1,624 个字符 |
| 纹理压缩／mip 只读审计 | 通过；282 项，压缩 161、mip 33、单层例外 4、首包 UI 原图 34、小纹理 87 |
| 新增运行时资源 `.meta` | 已检查，无缺失 |
| 全部 132 个 `.test.cjs`／`.test.mjs` 文件 | 1,555 项，1,545 通过，10 未通过，退出码 1 |
| 主线云服务娱乐开赛复现 | 标准成功，娱乐 `INPUT / 比赛参数无效` |
| 主线 schema 7 → 分支归一化复现 | 教学／外观字段不保留；15 级角色突破次数为 0 |
| Git 合并预演 | 69 个冲突；未执行真实合并 |
| `git diff --check` | 未通过，主要为 TapTap 供应商代码空白格式；低优先级，不代表运行失败 |
| 合并后构建／微信 iOS／Android／联机真机 | 尚未进行，待确认范围并实际整合后验证 |

测试运行使用 Node 24.19.0、TypeScript 5.4.5、tsx 4.20.5；在临时 clone 中执行。首次运行的 TypeScript 路径发现问题已修正，以下是修正后最终运行结果，不包含首次环境误报。

10 项未通过的分类：

| 数量 | 文件／原因 | 审查判断与处理 |
| ---: | --- | --- |
| 2 | `character-abilities.test.cjs` 的虚拟实体执行上下文没有注入新增 `blendGeyserAngle` | 源模块已有正确 import；更新夹具后重跑，当前不能算通过 |
| 1 | `online-room-runtime.test.cjs` 的方法抽取上下文没有注入 `platformEngagement` | 源模块已有 import；补平台门控夹具并验证原 UI 行为 |
| 2 | `event-picture-in-picture.test.mjs` 仍按四参数签名／旧调用文本匹配，代码已增加 `backgroundReserved` | 静态断言过时；按实际镜头规则更新断言 |
| 1 | `giant-wave-camera.test.cjs` 仍要求垃圾镜头抢占巨浪 | 与当前“背景垃圾让位主事件”的实现及新连续性测试冲突；统一预期后重跑 |
| 3 | TapTap 事件、启动、计时测试缺转换器本地 `@babel/parser` 等依赖，文件加载失败 | 环境依赖未满足，不能评为插件测试通过 |
| 1 | TapTap 启动画面测试依赖忽略的 `build/TapEvents-0.0.5/game/first-screen.js` | 当前 clone 无该产物；应准备可复现夹具或构建后再验 |

这 10 项没有直接证明 10 个玩法错误，但整套测试仍未通过；合并完成前需要处理测试夹具、旧预期和平台依赖。不能删除断言或简单跳过后宣称全部通过。

通过的离线覆盖包括蝶泳多帧率／计费／取消／恢复、动作关节与还原、娱乐排期／预算／后台障碍安全、事件控制器、跟游、联机编解码／排序／恢复、抖音监听与埋点、字体和纹理规则。Cocos GPU、网络真实时序、微信 iOS 和合并后的云端兼容仍需对应验证。

## 8. 建议整合顺序与用户确认项

确认范围后，从最新 main 创建独立整合分支，先复核主干基线和同名本地文件，再按功能实施迁移与重构。主工作区最近恢复的忽略文件应继续原位保留。

具体顺序：

1. 固定最新主干快照，核对主线性能、云规则、资源布局和原有行为的验证基线。
2. 明确新增功能的模块边界，把娱乐生命周期／接入细节从 `GameManager` 分离，让其继续承担编排职责。
3. 在 main 后台与联机架构上扩展娱乐票据、结算及事件同步，保留旧票据兼容、scope 门禁与房间保活。
4. 迁移娱乐控制器、AI、恢复和表现，按主线热路径要求调整更新频率、缓存及资源生命周期；迁移动作与离线蝶泳时保留 main 平衡和碰撞恢复。
5. 按所选功能接入运行时资产及平台工具，延续 main 的资源加载、图集、CDN 和构建审计，重新生成最终字集。
6. 修正必要的测试夹具和旧预期，在整合分支完成旧行为、新功能、组合及性能／构建检查，再审查最终差异。
7. 验证结果满足所选范围后合入 main；尚需用户设备或平台条件的验收明确记录，不把分支历史通过结果等同于整合版本通过。

合并验收至少覆盖：标准／狂野旧行为、娱乐 200／400 米五档、离线蝶泳与碰撞／转身／恢复、main 全角色与 0.8 节奏、同版本联机／不同 scope 拒绝／重赛／房主迁移、云端开赛／结算／旧票据、最终字体与纹理审计，以及微信首包和 iOS／Android 真机。TapTap 字体和抖音复访按各自待验项目保留。

**请用户确认以下范围，推荐值已经给出：**

| 决策 | 推荐选择 |
| --- | --- |
| 已确认的实施原则 | 以最新 main 的性能优化和云端逻辑为基础，按功能迁移并适当重构，再纳入主干 |
| 本次主体 | 娱乐玩法＋配套联机＋自由泳动作＋离线蝶泳＋TapTap／抖音工具，并完成必要的主线集成修正 |
| 蝶泳开放范围 | 按分支现状开放本地标准／狂野／娱乐与 AI 调试；联机／房间继续关闭 |
| 原有数值 | 保留 main 的 0.8 节奏、角色／技能／AI、生涯／Boss 和碰撞恢复；新参数增量加入 |
| 尾迹跟游 | 代码纳入，本次默认关闭；若希望立即启用，需要明确接受 15% 体力节省 |
| 每日补给／突破宝石 | 本次暂缓，之后与云端经济及新存档迁移一起做 |
| 美术原稿／预览／历史产物 | 本地保留，`art/` 不重新跟踪；运行时必需资产按功能纳入 |

用户已授权优先整合低风险独立内容；首批仅包含制作经验文档、TapTap 离线日志分析和抖音启动监听底座。表中互相依赖的游戏功能不因首批整合而自动纳入。本报告不授予部署、上传或正式发布权限。

## 附录：69 个合并冲突文件

以下为临时 clone 对固定快照执行合并预演得到的路径。冲突包括内容、二进制及文档移动相关冲突，不能统一选择 ours 或 theirs。

<!-- 冲突清单由本次固定快照预演生成，后续整合时按实际最新快照复核。 -->

### 运行时代码与资源（46 个）

```text
assets/race/fonts/ShuiMasterUI-Regular.ttf
assets/race/fonts/ShuiMasterUI-SemiBold.ttf
assets/resources/config/tuning.json
assets/scripts/app/GameFlowController.ts
assets/scripts/app/LoginManager.ts
assets/scripts/app/PlayerCharacterConfig.ts
assets/scripts/app/PrepareRaceCharacterPreview.ts
assets/scripts/app/StrokeSfxManager.ts
assets/scripts/backend/IBackend.ts
assets/scripts/backend/PlayerData.ts
assets/scripts/backend/PlayerProfile.ts
assets/scripts/character/SplashEmitter.ts
assets/scripts/competitor/RaceLaneAllocation.ts
assets/scripts/core/GameBalance.ts
assets/scripts/core/GameLaunchOptions.ts
assets/scripts/core/GameManager.ts
assets/scripts/core/InputRouter.ts
assets/scripts/core/ResourcePaths.ts
assets/scripts/core/TuningDebugControls.ts
assets/scripts/entity/AISwimmerController.ts
assets/scripts/entity/CartoonSwimmerRig.ts
assets/scripts/entity/Swimmer.ts
assets/scripts/entity/SwimmerCollisionResolver.ts
assets/scripts/net/NetRaceController.ts
assets/scripts/net/NetRaceInput.ts
assets/scripts/net/NetRaceProtocol.ts
assets/scripts/net/NetRaceSnapshot.ts
assets/scripts/net/WechatGameRoom.ts
assets/scripts/progression/CareerRules.ts
assets/scripts/progression/CupRewardConfig.ts
assets/scripts/swimmer/SwimPhysicsModel.ts
assets/scripts/swimmer/SwimmerMotor.ts
assets/scripts/ui/AiDebugSetupPicker.ts
assets/scripts/ui/CareerEventPage.ts
assets/scripts/ui/CareerPrototypePanel.ts
assets/scripts/ui/CharacterAttributeTips.ts
assets/scripts/ui/IdentityEditPanel.ts
assets/scripts/ui/LobbyUiMotion.ts
assets/scripts/ui/OnlineRoomView.ts
assets/scripts/ui/PopupUiMotion.ts
assets/scripts/ui/PrepareRaceFlow.ts
assets/scripts/ui/RaceHudStatusView.ts
assets/scripts/ui/ResourceHeadBar.ts
assets/scripts/ui/RoomFlow.ts
assets/scripts/ui/SwimmerNameOverlay.ts
assets/scripts/ui/UILayers.ts
```

### 文档（8 个）

```text
docs/README.md
docs/历史归档/早期方案/TapTap小游戏发布与数据埋点落地计划.zh.md
docs/历史归档/早期方案/抖音小游戏发布与数据埋点落地计划.zh.md
docs/大厅动效接入说明.zh.md
docs/开发记录/界面接入/prepare-race-character-selection.zh.md
docs/技术说明/联机同步/realtime-multiplayer-notes.zh.md
docs/游戏设计/赛制与养成/赛制奖励与角色培养设计.zh.md
docs/美术设计/界面设计/大厅与赛事二级界面设计.zh.md
```

### 构建与生成文件（5 个）

```text
extensions/wechat-race-subpackage/hooks.js
package.json
scripts/generated/ui-font-glyphs.txt
scripts/generated/ui-font-manifest.json
settings/v2/packages/information.json
```

### 测试（10 个）

```text
tests/ai-debug-ui.test.cjs
tests/career-ui.test.cjs
tests/helpers/cocos-math-harness.cjs
tests/lobby-motion.test.cjs
tests/online-room-runtime.test.cjs
tests/popup-motion.test.cjs
tests/race-hud-status.test.cjs
tests/settlement-runtime.test.cjs
tests/start-block-contact.test.cjs
tests/tuning-balance-integration.test.cjs
```
