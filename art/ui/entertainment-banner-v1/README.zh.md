# 娱乐广播与心跳苏打反馈美术源稿

本目录保存娱乐玩法广播与个人反馈的可复现源稿，不作为 Cocos 运行时资源。

- `event-banner-generated-source.png`：按已确认 A＋C 方向生成的广播底板母图。
- `stimulant-pickup-generated-source.png`：已确认新版心跳苏打个人反馈底板的透明高清母图。
- `stimulant-pickup-concept-c.png`：2026-09-20 选定的橙红强化徽章效果图。
- `stimulant-pickup-title-c.png`：从选定方向精修的透明美术字与心电线源稿。
- `stimulant-pickup-base.svg`：早期矢量草案，仅保留作结构参考，不再作为当前运行时导出源。
- `heartbeat-pulse.svg`：早期独立心电装饰线，仅保留作结构参考。
- `icon-*.svg`：六种正式娱乐事件及通用广播的统一低多边形图标。

运行时 PNG 导出到 `assets/race/ui/entertainment-banner-v1/`。新版心跳苏打底板按可见主体裁切后导出为 720×152，保留透明边缘；固定标题“心跳超频”和心电线直接烘焙进底板，右侧体力、心率等动态数值继续使用 Cocos `Label`，不得烘焙进图片。

广播底板的黄色、红色、绿色和蓝色版本由同一母图仅替换近白色强调区域得到；深蓝主体、透明边界和尺寸保持一致。图标源稿统一为 128×128，正式显示约 48～56 个设计单位。

## 小程序运行时压缩

- `art/ui/entertainment-banner-v1/` 只保存可复现源稿，不进入游戏包，不为压包删除高清母图。
- 运行时透明 PNG 使用感知调色板压缩，质量范围固定为 `80-95`；保留透明通道、文件名、资源路径和 `.meta`。若单张图片达不到质量下限，保留原始真彩色版本。
- `status-strip.png` 的运行时导出尺寸为 1020×102，显示尺寸仍为 560×56；其余图片保持原导出尺寸，避免为了少量体积牺牲锐度。
- 2026-09-20 清理未引用的 `event-banner-neutral.png` 后，四组娱乐 UI 共 16 张运行时 PNG，由 968757 字节降至 302978 字节，减少 68.7%。
- 图片替换后先运行项目图片审计，再运行 `npm run textures:fix` 与 `npm run textures:check`；纹理策略仍由项目脚本统一管理，不手改 Cocos 压缩字段。
