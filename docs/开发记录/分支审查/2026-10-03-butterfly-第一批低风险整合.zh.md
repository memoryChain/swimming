# butterfly 第一批低风险整合记录

日期：2026-10-03。整合基础：`main@777aa45172734f32c7b86b154eb9e764c9419869`。功能来源：`feature/butterfly-debug@e5dca0327ed8d5e70bf5f38d39489022491e8e4b`。

用户明确要求以主干最近的性能优化和云端逻辑为基础，按功能适当重构，并优先整合影响小、没有冲突的部分。本批采用独立分支逐项迁移，完成验证后纳入本地 main；后续批次保留原 feature 作为功能参考。

## 风险划分

是否优先纳入同时看四项：文本冲突、实际依赖、自动执行范围及验证可完成程度。单纯没有 Git 冲突不足以证明低风险。

| 批次 | 内容 | 处理 |
| --- | --- | --- |
| 第一批：影响小、依赖独立 | 四份模型／动作／UI 制作经验文档；TapTap 离线计时日志分析；抖音构建前置启动来源监听 | 本记录范围，已完成实现及针对性验证 |
| 后续：没有部分文本冲突，但接入风险较高 | TapTap 转换插件与诊断包生成链、抖音构建配置／本地 ZIP 制作、GLB mip 链生成与资产设置、新娱乐资源及控制器 | 按依赖组合整合，复核主干资源布局与真实构建，暂不纳入首批 |
| 后续：改动广或存在冲突 | 娱乐编排／AI／恢复／联机、自由泳姿态、离线蝶泳、数值、云端娱乐票据与结算、UI 接入 | 以 main 架构做功能迁移与适当重构，见总体审查报告 |
| 单独经济批次 | 每日补给、突破宝石、突破升级及关联存档／UI | 云端事务与新存档迁移完成后统一整合 |

## 本批纳入内容

### 制作经验文档

四个文件只加入已审查的增量经验，共 11 行；用共同基点到 feature 的补丁应用到 main，没有整文件替换。

- `.agents/skills/blender-superskill/SKILL.md`：顶点色色彩空间、道具握持净空、描边网格与蒙皮、静态单 primitive 描边的验证经验。
- `.agents/skills/speed-swimming-action-sampling/references/speed-swimming.md`：肘部松扭不能机械跨泳姿复用，应同时检查肩腋蒙皮形变。
- `tools/codex-skills/cocos-ui-asset-pipeline/references/cocos-prefab-notes.md`：透明素材低 alpha 尾迹和可见主体居中。
- `tools/codex-skills/cocos-ui-asset-pipeline/references/motion-and-vfx.zh.md`：半透明立体水壁的曲面叠色、绕序和法线检查。

main 的文档新路径、水花首拍检测、粒子休眠及热路径优化经验继续保留。此批未执行模型、UI、材质或动作修改。

### TapTap 离线计时日志分析

纳入 `scripts/analyze-taptap-timing.cjs` 和 `tests/taptap-timing-analysis.test.cjs`，仅依赖 Node 内置模块。手动运行后读取本地日志并输出分析，不注册游戏入口、不修改日志、不上传数据。

```sh
node scripts/analyze-taptap-timing.cjs /绝对路径/vconsole日志.txt
```

保留“缺记录／截断／矛盾时间保持未知”的规则；区分入口前后耗时，摘要阶段不相加当总耗时。本批没有引入 TapTap 转换插件、字体实验或平台发布配置。

### 抖音启动来源监听底座

纳入 `extensions/douyin-platform-tools` 的四个文件：`package.json`、`builder.js`、`hooks.js`、`launch-bootstrap.js`。插件只注册 `bytedance-mini-game`，`onAfterBuild` 也检查目标平台后才读写构建输出。

监听脚本在抖音 `game.js` 的引擎加载前执行，保留冷启动／早期展示来源；重复注入、重复运行不重复注册。只保存来源字段，不缓存 query 或登录资料。使用构建后输出副本验证，未启动 Creator、修改实际构建产物或上传平台。

从分支 `douyin-engagement.test.cjs` 拆出独立的启动／构建测试，存入 `tests/douyin-platform-tools.test.cjs`，补验证非抖音目标不访问输出目录、无宿主不建立桥接和冷启动兜底。测试不依赖尚未整合的 `DouyinEngagement`、侧边栏 UI 或比赛回调。

**本批仅完成启动来源捕获底座。** 侧边栏按钮、复访判定、埋点服务及比赛事件调用留在后续接入批次，不能把此批记录为抖音侧边栏或埋点完整上线。

## 为什么其他无冲突文件没有提前纳入

- 抖音构建 JSON 引用分支专用的引擎配置键，同时涉及 Bundle 压缩和资源结构；独立 ZIP 制作工具对普通本地 Bundle 有明确前提，需要针对主干 CDN／分包重新核对。
- GLB mip 策略必须同时具备完整 CMIP 生成、资产 meta、回退图片及构建审计，孤立修改采样会有 iOS 显示风险。
- TapTap 插件会注册编辑器与构建入口，并依赖转换器安装及主干 hook 的顺序；不能仅按新增文件无冲突判断可独立启用。
- 新玩法控制器虽然许多文件为新增，其行为依赖调用入口、AI、恢复和权威同步，不能用“先把新增文件全部放进来”代替功能整合。

## 验证结果与边界

- 选定的 10 个来源文件不在 69 个预演冲突文件中；共同基点到 feature 的补丁在 main 上 `git apply --check` 通过。
- 文档增量复核通过，主干已有路径和性能经验保留。
- 独立抖音启动／构建测试 4 项、TapTap 日志分析测试 5 项，共 **9 项全部通过**。
- 新增 JavaScript／CJS 文件语法检查与最终差异空白检查通过。
- 本批差异不涉及 `assets/`、`cloud/`、`settings/`、`package.json`、微信构建 hook、`.gitignore` 和 `art/`；现有运行时、存档、联机与微信资源策略保持主干实现。
- 未修改 TypeScript／Cocos 运行时代码，本批不需要重新跑无关的游戏全套或生成字体。抖音真实构建／手机验收留到完整平台接入批次；模拟检查不等于真机通过。
- 本地 Git 提交与整合不包含推送、云部署、平台上传或发布。

总体功能取舍与集成阻断见 [合并前审查报告](2026-10-03-butterfly-合并前审查.zh.md)。
