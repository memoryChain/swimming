# butterfly 娱乐模式与 mipmap 专项审查

审查日期：2026-10-03。本报告在前四批整合之后重新审查娱乐模式及相关纹理修改，记录最新范围、工程判断和后续批次建议。当前仅完成审查与文档，尚未合入娱乐运行时代码、资源或构建修改。

后续实施记录：[第五批 A：娱乐基础整合](2026-10-03-butterfly-第五批娱乐基础整合.zh.md)。下文保留本次专项审查时的判断与计划，实际交付范围以实施记录为准。

## 1. 结论与最新范围

**娱乐玩法有保留价值，但应以当前 main 为基础重构接入，不能原样搬入整套 GameManager、网络协议、存档与数值。** 来源已有确定性排期、池化表现、状态恢复和不少实际控制器测试。主要问题是集成边界和主干兼容性；不能仅根据作者背景判断实现对错。

建议下一批先做娱乐基础模块，再接入补给与轻障碍的本地调试验证。正式入口、奖励结算及娱乐联机需要后续单独完成其云端和协议条件。

用户最新决定优先于初始总体报告：

- 抖音打包、TapTap 接入及其附带构建配置暂缓，等待负责同事确认和平台验证。保留已经合入的统一跨平台埋点接口。
- 蝶泳保留已经合入的独立模型预览；正式比赛蝶泳及进一步 AI 操控接入暂缓。
- 优先审查和重构娱乐模式，不带入每日补给、突破宝石、突破养成或跟游体力节省。
- mipmap 与娱乐玩法无必需依赖，独立处理。本批不改纹理采样、压缩策略或构建钩子。

## 2. 固定快照与依据

| 项目 | 快照 |
| --- | --- |
| 目标 main / origin/main | `698b95a757ec06dbea9dc76ab1fe431aa613e0fb` |
| 来源分支 | `feature/butterfly-debug` |
| 来源提交 | `e5dca0327ed8d5e70bf5f38d39489022491e8e4b` |
| 共同基点 | `69e58d162f72c6347161ea0f4e9bd8f625b88ac3` |
| 来源读取工作树 | `/Users/abao/.codex/worktrees/butterfly-review/swimming` |

依据仓库 AGENTS、UI 技能的运行时与动效规范、联机同步说明第 8 节，以及当前 main 的云服务、角色、数值和性能实现。没有联网刷新分支、连接线上云服务、启动 Creator、构建或上传平台包。

来源证据链接指向上述只读工作树，定位应以固定提交为准。初始 [总体报告](2026-10-03-butterfly-合并前审查.zh.md) 保留历史快照，不回写旧范围。

## 3. 必须处理的发现

### E1 · P1：正式娱乐入口与 main 云端不兼容

来源正式入口用 `rule='entertainment'` 申请比赛票据，但 main 的云端 `begin` 仅接受 `standard` 与 `wild`。本轮再次通过真实云服务代码和内存数据库夹具复现：`standard` 成功；同样的新账号请求改为 `entertainment` 后返回 `INPUT / 比赛参数无效`。这会直接阻止正式开赛。

处理要求：在 main 的规则和云服务上增量扩展娱乐开赛、票据及结算。保留服务端种子、事务、幂等、票据归属、超时和旧版本兼容；明确娱乐强度、AI 规格与奖励的权威来源。不能通过切回 MockBackend、冒用标准赛票据或绕过结算校验开放入口。

证据：[主干云校验](/Users/abao/Documents/GitHub/swimming/cloud/src/service.cjs:150)、[来源规则入口](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/progression/CareerRules.ts:100)。本地调试试用可以先做，但应独立于账号奖励和生涯写入。

### E2 · P1：来源协议不能整体替换主干协议

main 的协议版本为 53，握手包含 `scope`，用于隔离云数据范围；来源为 130，但其握手没有这项声明。更大的编号不代表包含主干的新能力。来源娱乐模式确有可靠命中、事件代次、周期快照、晚到恢复和房主迁移处理，应该逐项迁移到主干协议基础上。

处理要求：保留主干范围门禁、输入顺序、owner 状态及保活重赛；娱乐开局身份、事件代次、命中去重和恢复状态使用统一的新协议版本。补给改变体力与心率，障碍改变速度与位置，均影响名次，不能归为纯视觉功能。每个事件需要明确本地玩家、远端真人和房主 AI 的权威边界。

证据：[主干 scope](/Users/abao/Documents/GitHub/swimming/assets/scripts/net/NetRaceProtocol.ts:53)、[来源握手](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/net/NetRaceProtocol.ts:149)、[来源恢复接线](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:2776)。离线协议测试通过不能替代微信混合设备、断流和切主验证。

### E3 · P1：不能伴随娱乐接入覆盖公共存档、数值与角色

两边 `schema=7` 的字段含义不同：main 保留教学和逐角色外观；来源含每日补给及突破逻辑。初始总体审查已确认直接采用来源归一化会丢主干字段，且相同版本号不能触发所需迁移。这些公共文件仍必须以 main 为基础。

主干的 12 个角色、0.8 动作倍率、碰撞恢复、教学、生涯/Boss 和云端逻辑继续保留。尤其不能复制来源旧角色资源覆盖 `16212eb` 的角色 16 袖肩蒙皮修复，或退回角色专属转体 workaround。娱乐参数应独立命名和冻结，不整份覆盖 `tuning.json` 或 GameBalance。

证据及存档复现见 [总体报告 F2](2026-10-03-butterfly-合并前审查.zh.md)。本批不新增经济字段，也不提高存档版本来掩盖兼容问题。

### E4 · P2：普通比赛也执行娱乐目标清理

来源 `update()` 无条件调用漩涡、炮击、水球、浮标的更新方法。在没有相应控制器或未启用事件时，这四个方法每帧遍历 AI，并清空其娱乐横向目标。

本轮提取真实方法回放：七名 AI、无娱乐控制器、普通比赛运行 60 帧，共执行 **1,680 次目标清空，即每帧 28 次**，另有 240 次自动驾驶查询。它不是已测得的掉帧结论，但确认给普通模式增加了无用工作，违反隐藏/未启用功能应提前返回的约束。

处理要求：未挂载娱乐模块时从总入口直接返回；事件退出时清理一次。来源喷泉已有 `_geyserAiTargetsActive` 状态边沿清理，可沿用这种做法。

证据：[总更新入口](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:841)、[漩涡](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:2518)、[炮击](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:2983)、[水球](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:3253)、[浮标](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:3610)、[喷泉边沿清理](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:2747)。

### E5 · P2：接入编排和资源初始化过度集中于 GameManager

来源 GameManager 共 6,826 行，相对共同基点新增 3,582 行、删除 171 行。娱乐排期、AI 接线、恢复、资源创建、UI 通知和网络监听大量集中在其中。部分控制器及表现资源在 `update()` 中首次同步创建；这是事件首帧资源峰值风险，尚未测得真机耗时。

来源也有赛前水花预热、模型预加载及炮台预热，不能将所有构造器中的数组、网格生成或材质创建误判为逐帧分配。需要统一生命周期，而不是把全部代码推倒重写。

建议新增 `app/EntertainmentRaceRuntime` 负责挂载、赛前准备、事件启动/退出、重赛及销毁；规则和计划保持纯数据，运动效果进入 swimmer/physics，表现、UI、镜头和网络适配独立管理。GameManager 只提供稳定上下文并转发少量生命周期调用。预热仅针对本局会用到的资源，避免一次加载所有娱乐资产。

证据：[准备阶段](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:1768)、[补给首次创建](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:2407)、[事件启动](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/core/GameManager.ts:2124)。

### E6 · 验证缺口：画中画有一项旧测试与现行优先级不一致

`giant-wave-camera.test.cjs` 要求垃圾镜头抢占巨浪；当前 `updateLitter()` 明确禁止背景垃圾抢占主事件镜头，背景安全与连续性测试也验证了让位行为。复现时实际仍为 `giant-wave`，测试期望 `litter`。

这属于需求/测试契约不一致，不能直接认定产品逻辑出错，也不能把整个测试集描述为全绿。迁移镜头时应明确“主事件优先、背景垃圾让位”的规则，再更新旧断言并验证抢占、恢复、过期和重赛。第一批补给/障碍试用暂不需要画中画。

证据：[旧断言](/Users/abao/.codex/worktrees/butterfly-review/swimming/tests/giant-wave-camera.test.cjs:55)、[当前优先级](/Users/abao/.codex/worktrees/butterfly-review/swimming/assets/scripts/camera/RaceEventPictureInPictureCamera.ts:564)。

## 4. 值得保留的实现与性能边界

- 比赛计划使用独立 SeededRandom 子流、明确强度档和 identity；补给、障碍与主事件互不扰动随机流。联网计划不消费本地节奏调参。
- 导演区分预告、活动、间隔和收尾；首名完赛后停止新的投放/搭乘，并允许已经触发的事件结算。
- 恢复控制器统一击倒、复位、无敌，使用全局 revision、泳道退役和阶段单调校正。比各子玩法各自恢复角色更容易保持一致。
- 共用水花预建六份网格、十个槽位，以 20Hz 更新表现；无活动槽位时直接返回。构造时生成固定网格与每帧重建几何不同，符合当前允许的固定网格材质动画方向。
- 漩涡复用三层网格；喷泉复用固定表现资源；巨浪有固定网格与重开资源稳定性测试。保留池化思路，逐项核算同时可见的渲染组件与透明层数。
- 恢复 HUD 按状态启动 Tween，进度限频并比较离散步骤；调试强度 HUD 在隐藏时提前返回。不是所有 Graphics 调用都在每帧执行。

画中画虽复用一个 256×144 RT、一个相机，并限频到最多 30Hz，仍增加一个场景渲染通道；低分辨率不等于零成本。源默认开启，正式接入需对照主干姿态裁剪、相机可见层、透明 overdraw、CPU/GPU 帧时和包体评估。调试开关不能替代低端 iOS 真机预算。

以上为代码及离线测试结论，没有测量真实 draw call、设备内存或帧率；不将 GPU 组件夹具的计数当作真机性能数据。

## 5. 建议分批范围

| 顺序 | 建议内容 | 纳入条件与边界 |
| --- | --- | --- |
| A · 下一批 | 事件 ID、确定性规则/计划、模块接口和生命周期；本地调试中的补给、轻垃圾/浮标 | 拆出运行模块，普通赛零娱乐更新；局部重用主干运动/体力逻辑；无账号奖励或正式房间开放 |
| B | 完整导演接线、非致命场地事件：漩涡、巨浪、喷泉 | 分别验证同局切换、折返、帧率差异、受击和完赛收尾；热路径与特效资源预算通过 |
| C | 炮击、定时水球、鲨鱼及共用击倒/复位/无敌 | 先统一恢复生命周期和运动入口，再接事件；验证终点、退出、重赛及全部主干角色 |
| D | 海龟班车和画中画 | 搭乘牵引、扶圈动作、碰撞和可见性耦合较多；独立验证，避免拖慢前面批次 |
| E | 正式娱乐入口、五档完整体验、云票据/结算及娱乐联机 | 在 main 云端和协议上增量扩展；客户端/云规则匹配，双设备断流、切主与保活重赛验证后开放 |
| 独立暂缓 | mipmap、抖音、TapTap、正式蝶泳、经济扩展、跟游节省 | 不作为娱乐接入的附带改动 |

顺序是工程迁移建议，不改变策划已设计的完整五档体验。A 阶段使用明确的调试事件列表，不能让完整随机计划调用尚未接入的事件，也不能把删减版冒充完整正式玩法。后续可以在各事件接入时准备对应网络数据接口，但正式联机入口需通过 E 阶段验证。

A 阶段不搬入全套调试面板、准备页、公共数值和账号存档；新增调试按钮或文案需要走现有 UI 生命周期与字体生成检查。资源按实际引用迁移、保留 UUID/已有 meta 和 race 分包路径。

## 6. mipmap 专项结论

**来源最终版本有完整链方案，未发现“只把采样开成 linear、仍输出单层 ASTC”的问题；不建议仅因作者背景整批回退。** 但其真实构建与双端视觉、内存、包体尚未在本轮验证，因此不随娱乐迁入。

来源历史包含启用、回退和最终补齐：`4c4175a`、`5ac00ca`、`ab36d07`。应审查最终快照，不能把中间实验当作最终实现。

与当前 main 的共同资源逐项比较：13 个 meta 文件中的 17 个纹理 sampler 从 `none` 改为 `linear`；其中角色 11 项、泳池/起跳台 6 项。比较的 `minfilter`、`magfilter`、`wrapModeS/T` 没有变化。两边 builder 的 `genMipmaps` 均为 true。这个统计只覆盖共同资源的采样属性，不代表所有 meta 字段或模型二进制相同。

来源最终方案包括：

1. 角色 GLB、泳池常规内嵌纹理启用 mip；三张纯色色板保持单层。其他道具 GLB 和主包 UI 不因本方案统一启用。
2. 在 `onBeforeCompressSettings` 对缺少多级数据的 GLB 内嵌 ASTC 补齐到 1×1，并使用 Cocos 的 CMIP 包装；原 GLB、UUID 和 PNG/JPG 回退不改。
3. 按当前导入器的 files 声明选 library 原图，拒绝旧 PNG/JPG 缓存混用；缓存包含源图、基础层和质量摘要。
4. 构建后检查 CMIP 层数、连续尺寸、ASTC 块大小与完整数据、尾层以及回退存在性；单层裸 ASTC 和损坏链会被拒绝。

本轮检查与补充验证：

- 对照本机 Cocos 3.8.8 的 `ImageAsset.parseCompressedTextures` 核对 CMIP 格式。
- 7 项源测试通过，覆盖格式、截断、缺层、回退、资源身份及构建检查；其中含临时夹具的转换/包检查，不计作 TapTap 平台验收。
- 使用真实 ASTC 编码器和 sharp，对 17×9、1×32、64×64 的临时图片运行生成、已有完整链复用和缓存复用，再运行引擎实际解码方法验证尺寸及所有层数据；源图、meta、回退保持不变。

这里验证了补链算法和包装，没有运行 Creator 完整构建，未验证实际插件钩子排序、MD5/CDN 产物及 iOS/Android GPU 显示。不得将这些离线验证描述为真机通过。

需要注意：当前 main 的 mip 策略仍将 GLB 内嵌纹理设为 `none`；仓库约束已经写入“完整链后启用采样”的目标，二者目前尚未完全落地。未来若采用完整链方案，应整体迁移策略、补链钩子和产物门禁，再按 main 当前资源重新生成/审计 meta，不能只复制来源的 linear 设置，也不能为这件事覆盖新角色 GLB。

完整 mip 会增加压缩包与 GPU 数据。大尺寸二维纹理常近似增加三分之一，但 ASTC 小层有整块取整及头部开销，不能直接套比例做精确预算。例如本轮 64×64 的 ASTC 从 1,952 字节增到 2,916 字节；应以真实全资源构建产物汇总。还需检查换色遮罩的边缘、UV 接缝、远景清晰度和三色色板例外。

证据：[来源策略](/Users/abao/.codex/worktrees/butterfly-review/swimming/extensions/wechat-race-subpackage/texture-mipmap-policy.js:16)、[补链实现](/Users/abao/.codex/worktrees/butterfly-review/swimming/extensions/wechat-race-subpackage/embedded-texture-mipmaps.js:51)、[构建钩子](/Users/abao/.codex/worktrees/butterfly-review/swimming/extensions/wechat-race-subpackage/hooks.js:99)、[主干策略](/Users/abao/Documents/GitHub/swimming/extensions/wechat-race-subpackage/texture-mipmap-policy.js:14)。

## 7. 验证记录与交付边界

| 检查 | 结果 |
| --- | --- |
| 娱乐规则、排期、恢复、玩法纯测试 | 237 / 237 通过 |
| 娱乐控制器、表现、真实数学/骨架、重赛与生命周期测试 | 166 项；补齐测试环境后 165 通过、1 项旧镜头契约不一致 |
| 喷泉网络、协议乱序、补给 roster、微信网络策略 | 47 / 47 通过 |
| 娱乐相关合计（去除环境重跑的重复计数） | **450 项，449 通过，1 项契约不一致** |
| mip 策略与补链源测试 | 7 / 7 通过 |
| 真实补链/缓存/引擎解析 | 三组尺寸全部通过 |
| 正式云入口夹具复现 | standard 成功；entertainment 被拒绝 |
| 普通赛未启用娱乐时的真实更新方法回放 | 七名 AI 每帧 28 次无用目标清理 |
| 原本地忽略文件 | 原 851 个文件/链接路径、大小、mtime、mode 未变，851 个仍忽略 |

来源工作树没有 Creator 生成的 `temp/tsconfig.cocos.json`。首次运行的环境失败不计作产品缺陷；以 COCOS_ENGINE_ROOT 及临时读取映射复用本机已有配置后重跑了相关测试，未写入来源工作树或修改源测试。GPU 与资源完成时机仍由夹具模拟。

复现脚本与日志暂存于 `/private/tmp/swimming-butterfly-review-_ehn8e85/`：`review-entertainment-extra.cjs`、`review-mipmap-bake.cjs`、`repro-cloud.cjs` 和 `entertainment-*-special.log` 等。它们不是持久化工程测试，迁移实现时应将必要回归用例整理进仓库。

本轮交付仅本报告与导航。未改动游戏代码/资源/配置，未合入来源提交，未提交或推送本轮文档。第一批娱乐实施范围建议为表中的 A，待用户确认后按功能重构接入。
