# Audio source notes

## 2026-09-22 G 实际文件与调用盘点

本轮五个音频均通过 `ffprobe` 格式读取和 `ffmpeg -v error -i <文件> -f null -` 全段解码，原资源、音量与播放代码未改。**没有进行人工试听**；文件可解码不证明听感、无人声或手机混音符合要求。

| 运行时文件（`assets/music/`） | 实际格式／时长 | 调用与状态 | 交接 |
| --- | --- | --- | --- |
| `login_ripples.mp3` | 44.1kHz 双声道，15.088 秒 | `LoginManager` → `MusicManager.playLogin`；基础音量 0.44 | 当前仓库没有三首音乐的完整来源／授权链记录，发布前补核；未试听 |
| `race_current.mp3` | 44.1kHz 双声道，41.143 秒 | `GameManager` → `playRace`；0.60 | 同上 |
| `result_sunlit_podium.mp3` | 22.05kHz 单声道，8.072 秒 | `GameManager` → `playResult`；0.66 | 同上 |
| `sfx/stroke_water_01.wav` | PCM16，44.1kHz 双声道，1.115 秒 | `GameFlowController` 划水，普通 0.32／完美 0.52；巨浪调试复用 | 与下方旧处理记录的“0.50 秒／单声道 22.05kHz”不同，需核对现文件的制作来源并试听；不能仅凭原文件名判为溺水声 |
| `sfx/buoy_balloon_pop.wav` | PCM16，22.05kHz 单声道，0.180 秒 | `GameManager` 浮标破裂回调 → `StrokeSfxManager.playBuoyPop`；0.48，至少 120ms 间隔、最多两声重叠 | E 原创合成源与制作记录位于 `art/water-play-obstacles/`；未试听 |

三首背景音乐沿用同一常驻播放器与异步请求代次；音效沿用独立设置、静音早退、预加载和后台清理规则。没有发现另外的鲨鱼惨叫、炸药爆炸或苏打医疗播报音轨，不因想象的问题制作替代声音。`SettingsManager` 音量持久化与播放器状态测试通过；真机仍需听浮标叠加划水、音乐切换、静音恢复和切后台，检查响度与残留播放。

## 早期划水音来源记录（需与当前文件重新核对）

### Player swim-stroke effects

- Source: [Water Splash and sand footsteps](https://opengameart.org/content/water-splash-and-sand-footsteps)
- Source file: `drowning.wav`
- Creator: Peludo
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Processing: retained the full 0.50-second splash and water-flow tail, converted it to mono 22.05 kHz PCM, removed moving voice harmonics frame by frame, filled the removed bins with spectral texture learned from the clean opening water sound, faded both edges, and peak-normalized.

The resulting runtime file is `assets/music/sfx/stroke_water_01.wav`.
