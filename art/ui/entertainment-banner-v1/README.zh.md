# 娱乐广播与心跳苏打反馈美术源稿

本目录保存娱乐玩法广播与个人反馈的可复现源稿，不作为 Cocos 运行时资源。

- `event-banner-generated-source.png`：按已确认 A＋C 方向生成的广播底板母图。
- `stimulant-pickup-generated-source.png`：已确认新版心跳苏打个人反馈底板的透明高清母图。
- `stimulant-pickup-concept-c.png`：2026-09-20 选定的橙红强化徽章效果图。
- `stimulant-pickup-title-c.png`：从选定方向精修的透明美术字与心电线源稿。
- `stimulant-pickup-base.svg`：早期矢量草案，仅保留作结构参考，不再作为当前运行时导出源。
- `calm-slush-pickup-title.svg`：按“心跳超频”的四字标题与单条节奏线结构制作的冷色标题源稿，不增加额外装饰层。
- `heartbeat-pulse.svg`：早期独立心电装饰线，仅保留作结构参考。
- `icon-*.svg`：早期六事件及通用广播的矢量源稿；已被后续位图替换的图标只作历史参考，不能覆盖现行输出。
- `icon-timed-bomb-generated-source.png`：现行橙黄定时水球图标，与 `art/timed-water-balloon/icon-timed-water-balloon.png` 及肩背水球对应；旧文件名保留资源身份，不表示炸药。2026-09-20 的管状炸药束版本仅可从 Git 历史回看。
- `icon-shark-generated-source.png`：现行修长充气玩具鲨图标，作者源与关键短咬姿态见 `art/shark-animation/`；对应“玩具开咬”。
- `icon-cannon-generated-source.png`：现行抬头水球炮图标；`icon-mine.png` 对应黄色气球、系带与圆盘浮标，两者作者源见 `art/water-play-obstacles/`。
- 七事件中的杂物使用通用 `icon-broadcast.png` 配合“赛道异物”栏目，没有独立杂物图标；冰沙作为补给子类使用 `icon-calm-slush.png`，不另计入七事件。

运行时 PNG 导出到 `assets/race/ui/entertainment-banner-v1/`。新版心跳苏打底板按可见主体裁切后导出为 720×152，保留透明边缘；固定标题“心跳超频”和心电线由 `stimulant-pickup-title.png` 独立承载，用于短促震动和双心跳演出。右侧体力、心率等动态数值继续使用 Cocos `Label`，不得烘焙进图片。

冷静冰沙个人反馈直接复用同一张心跳苏打底板和同一组运行时坐标，只替换左侧图标与中央“强制冷静”标题。右侧显示有效配置的推进百分比（当前 90%）和真实心率，继续使用原青色推进槽与橙色心率槽。两种卡均增加程序字“游戏道具效果”；S1 保留游戏心率设定，不表示现实生理功效或平台适龄审核通过。

广播底板的黄色、红色、绿色和蓝色版本由同一母图仅替换近白色强调区域得到；深蓝主体、透明边界和尺寸保持一致。图标源稿统一为 128×128，正式显示约 48～56 个设计单位。

## 小程序运行时压缩

- `art/ui/entertainment-banner-v1/` 只保存可复现源稿，不进入游戏包，不为压包删除高清母图。
- 运行时透明 PNG 使用感知调色板压缩，质量范围固定为 `80-95`；保留透明通道、文件名、资源路径和 `.meta`。若单张图片达不到质量下限，保留原始真彩色版本。
- `status-strip.png` 的运行时导出尺寸为 1020×102，显示尺寸仍为 560×56；其余图片保持原导出尺寸，避免为了少量体积牺牲锐度。
- 2026-09-20 清理未引用的 `event-banner-neutral.png` 后，四组娱乐 UI 共 16 张运行时 PNG，由 968757 字节降至 302978 字节，减少 68.7%。
- 图片替换后先运行项目图片审计，再运行 `npm run textures:fix` 与 `npm run textures:check`；纹理策略仍由项目脚本统一管理，不手改 Cocos 压缩字段。
