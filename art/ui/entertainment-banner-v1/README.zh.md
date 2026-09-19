# 娱乐广播与心跳苏打反馈美术源稿

本目录保存娱乐玩法广播与个人反馈的可复现源稿，不作为 Cocos 运行时资源。

- `event-banner-generated-source.png`：按已确认 A＋C 方向生成的广播底板母图。
- `stimulant-pickup-base.svg`：无文字的心跳苏打个人反馈底板。
- `heartbeat-pulse.svg`：可染色的心电装饰线。
- `icon-*.svg`：六种正式娱乐事件及通用广播的统一低多边形图标。

运行时 PNG 导出到 `assets/race/ui/entertainment-banner-v1/`。所有文案和动态数值必须继续使用 Cocos `Label`，不得烘焙进图片。

广播底板的黄色、红色、绿色和蓝色版本由同一母图仅替换近白色强调区域得到；深蓝主体、透明边界和尺寸保持一致。图标源稿统一为 128×128，正式显示约 48～56 个设计单位。
