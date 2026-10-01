# Audio source notes

## Player swim-stroke effects

- Source: [Water Splash and sand footsteps](https://opengameart.org/content/water-splash-and-sand-footsteps)
- Source file: `drowning.wav`
- Creator: Peludo
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Processing: retained the full 0.50-second splash and water-flow tail, converted it to mono 22.05 kHz PCM, removed moving voice harmonics frame by frame, filled the removed bins with spectral texture learned from the clean opening water sound, faded both edges, and peak-normalized.

The resulting runtime file is `assets/music/sfx/stroke_water_01.wav`.

## 游戏背景音乐（2026-09-26）

已按用户确认接入三段优化音乐：赛前第四版、赛中第一版、结算第一版。保留用户原 Strudel 音乐的旋律录音主体，使用官方 Strudel 引擎制作新鼓组、贝斯与和声；新增音色均为合成，无外部录音采样。

运行时为 `assets/music/login_ripples.mp3`、`race_current.mp3`、`result_sunlit_podium.mp3`，原文件名及 `.meta` 保留。三首合计 789,499 字节，比原版小 3.86%。对应乐谱、导出脚本、原版备份位置和验证报告见 [Strudel 制作与接入记录](music-strudel.zh.md)。
