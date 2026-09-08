# 比赛起跳 UI 接入

用户确认准备阶段使用蓝色 READY 和「长按蓄力，听令起跳」，发令为黄色 GO!；使用最终 PSD 的 Bungee 字效。GOOD START!、GREAT START!、PERFECT START! 从最终 LATE START! 复制文字与图层效果补齐。READY ON THE BLOCK 保留在设计源，不导入游戏。

## 素材与导出

源文件是设计目录「比赛HUD/划水大师-比赛HUD-起跑提示与蓄力.psd」。打开最终文件后，在 Photoshop 执行 `scripts/export-race-start-runtime.jsx`。只使用临时副本隔离、合并与裁切，保留主稿可编辑层。重新导出后核对本目录 `runtime-export-layout.json` 与 `RaceStartView.ts` 的裁剪尺寸是否一致。不要运行历史样式重建脚本覆盖设计师精修。

11 张运行时 PNG 位于 `assets/race/ui/race-start-v1`，使用 race 分包；资源路径统一在 `ResourcePaths.raceStartUi`。初次无损重编码由约 1434.3 KiB 降至 116.3 KiB；按用户后续设计重新导出四档评价后，全部 11 张图共约 127.5 KiB，其中四档评价约 92.0 KiB。固定英文标题为批准的美术字精灵；中文操作文案使用项目 SemiBold Label 与深色半透明描边，不依赖本机字体。没有新增按钮或可见触控区。

槽体、填充、白标分别导出；低、中、高三张填充共用 72×233 画布，用垂直 FILLED 裁切，不缩放填充高度。中心线为 `x = 1234 - (y - 226) × 0.2`；填充从设计坐标 y502 向 y269 增长，白标随裁切顶端移动。橙红、绿、金黄仍按原 `>0.45`、`>0.82` 阈值切换。

## 显示与玩法

`RaceStartView` 一次创建所有节点，资源预加载成功后才交付比赛 HUD。旧 CountdownLabel、CountdownShade、DiveChargeTrack、DiveChargeFill 保留 prefab 引用但关闭显示，赛末等待其他选手的倒数不受影响。

- READY 持续显示中文提示，并展示空槽；长按时显示蓄力。
- GO 显示约 0.68 秒（含淡出）。同帧提交起跳时，评价排在 GO 之后。
- 普通、优秀、完美评价保持原 0.55／0.85 阈值，偏晚标志优先。评价显示约 1.03 秒（含淡出）。
- 滑行阶段隐藏蓄力，已排队评价继续播放；正式划水、退出或重置时取消提示和排队状态。
- 维持 GameFlowController／RaceManager 当前时序，没有新增可视 3／2／1，没有修改输入、运动、网络协议、起跳收益或单机／联机判定。

布局按 1290×720 等比适配，发令组靠下居中，蓄力组贴右侧；右侧安全区与设计 35px 边距取较大者。监听屏幕尺寸事件，销毁时解绑。运行时不添加 Mask、Graphics 发光或粒子。

## 性能与验证

此次新增的比赛帧路径只有蓄力显示刷新：隐藏时直接返回，可见时最多 30Hz，按显示像素量化；填充、白标、颜色资源仅在变化时写属性。中文 Label 仅创建时赋值，动画仅状态切换时启动，无每帧对象、字符串或数组分配。GameManager → UIFlow → UIController 的新调用只更新显示快照；其他既有 HUD 逻辑未改动。

自动检查：`tests/race-start-runtime.test.cjs` 执行真实显示类，覆盖 READY、发令与评价竞争、判定阈值、填充固定几何、往返颜色、30Hz、隐藏零刷新、重复节点稳定、窗口适配、退出取消及加载失败。使用 TypeScript 5.4.5 做类型检查，运行 `pnpm fonts:build`、`pnpm fonts:check` 和图片无损审计。

新增图片及 TS 的 `.meta` 必须由现有 Creator 会话生成，不能手写 UUID。生成后执行 `pnpm textures:fix` 与 `pnpm textures:check`。缺 `.meta` 的新图片不在纹理审计覆盖范围，已有纹理审计通过不能作为它们已导入的证据。

本轮不启动、重启或截图 Creator。待用户在现有会话核对单机和联机：READY 中文可见，长按与取消、三色往返、发令同帧起跳、各档评价及偏晚、退出重入、宽屏安全区。微信 iOS／Android 真机还需验证透明边缘、字体、ASTC 与 PNG 回退、层级及绘制开销；离线检查不代替真机验收。

## 2026-09-08 四档评价更新

从当前打开的最终 PSD 重新导出 GOOD（绿色）、GREAT（蓝色）、PERFECT（金黄）、LATE（粉色外光）的四组，保留组内原有显隐状态。四张裁剪位置和尺寸未改变，运行时布局和判定不变。PERFECT 重新导出后的像素与上一版相同。其他七张 PNG 的校验值未变。四张均完成无损压缩、alpha 与尺寸检查；当前仍待 Creator 生成 `.meta`，新图尚不在纹理政策审计覆盖内。
