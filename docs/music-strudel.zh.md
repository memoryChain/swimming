# 游戏音乐：Strudel 制作与接入

2026-09-26，用户确认的三段优化音乐已接入游戏。后续新创作的赛中曲未采用，其乐谱与导出入口已清理。`scripts/music` 只保留当前成品所需的三份乐谱、三份验证报告和两个制作工具。

## 当前采用版本

| 场景 | 乐谱 | 运行时资源 | 字节数 |
| --- | --- | --- | ---: |
| 赛前 | [login-arrangement-v4.strudel.js](../scripts/music/login-arrangement-v4.strudel.js) | `assets/music/login_ripples.mp3` | 214,352 |
| 赛中 | [race-arrangement-v1.strudel.js](../scripts/music/race-arrangement-v1.strudel.js) | `assets/music/race_current.mp3` | 494,385 |
| 结算 | [result-arrangement-v1.strudel.js](../scripts/music/result-arrangement-v1.strudel.js) | `assets/music/result_sunlit_podium.mp3` | 80,762 |

合计 **789,499 字节（771.00 KiB）**，比原版 821,218 字节减少 **3.86%**。原资源文件名、UUID、导入配置、播放音量与循环逻辑保留。

三首都保留用户原曲的旋律录音主体，再由官方 Strudel 引擎制作鼓组、贝斯与和声。旋律素材使用保守的持续音／瞬态频谱分离，不是原始分轨，也不是恢复了原曲乐谱；原有 MP3 损失的音质不能通过重新编码恢复。新增伴奏均为合成音色，没有外部录音采样。

- 赛前：126 BPM、8 小节、15.238095 秒，112 kbps 立体声；保留原旋律，重新制作 C／G／Am／F 低音、短拍手与简洁电钢琴和声。
- 赛中：140 BPM、24 小节、41.142857 秒，96 kbps 立体声；保留完整结构，伴奏随中段收束与最后八小节展开。
- 结算：120 BPM、4 小节、8 秒，80 kbps 立体声；保留原主题，以半拍鼓点、柔和贝斯与电钢琴伴奏。

## 哪些文件会打包

游戏只使用 `assets/music` 内的音乐成品，通过 `music` 微信分包加载。`scripts/music` 是项目根目录的离线制作工具目录，不是 `assets/scripts`，不会作为游戏代码或资源打包。

文档、测试以及 `art/audio` 内的原版备份、WAV 母带和本地试听也不进入游戏；`art/` 由 Git 忽略。制作依赖 Strudel、Playwright、Chrome、FFmpeg、Python／NumPy，不添加到游戏运行时依赖。

## 可复现制作

保留的两个工具：

- [prepare-melodic-bed.py](../scripts/music/prepare-melodic-bed.py)：从原版 MP3 制作旋律录音素材。
- [render-preserve-melody.cjs](../scripts/music/render-preserve-melody.cjs)：默认使用当前已采用乐谱，校验事件与循环周期，通过官方 `@strudel/web@1.3.0` 离线渲染，再编码 MP3。

修改前的三份原 MP3 位于被忽略的 `art/audio/strudel-20260926/original/`。跨机复现需另外携带这些原始素材，或从替换前的 Git 版本提取。**不要把当前 `assets/music` 成品作为原始素材重复加工**；渲染脚本会校验原始 SHA-256。

以下命令在项目根目录运行。`FFMPEG`、`STRUDEL_MODULE`、`CHROME` 分别由本机环境指定 FFmpeg、官方包 `dist/index.mjs` 和 Chrome 可执行文件路径；Node 需能加载 Playwright，Python 需能加载 NumPy。

```sh
# 赛前
python3 scripts/music/prepare-melodic-bed.py "$FFMPEG" art/audio/strudel-20260926/original/login_ripples.mp3 art/audio/music-export/login/original-melodic-bed.wav
node scripts/music/render-preserve-melody.cjs "$STRUDEL_MODULE" "$CHROME" "$FFMPEG" art/audio/music-export/login --track=login --source=art/audio/strudel-20260926/original/login_ripples.mp3

# 赛中
python3 scripts/music/prepare-melodic-bed.py "$FFMPEG" art/audio/strudel-20260926/original/race_current.mp3 art/audio/music-export/race/original-melodic-bed.wav
node scripts/music/render-preserve-melody.cjs "$STRUDEL_MODULE" "$CHROME" "$FFMPEG" art/audio/music-export/race --track=race --source=art/audio/strudel-20260926/original/race_current.mp3

# 结算：去除原文件的编码延迟，再取完整四小节。
python3 scripts/music/prepare-melodic-bed.py "$FFMPEG" art/audio/strudel-20260926/original/result_sunlit_podium.mp3 art/audio/music-export/result/original-melodic-bed.wav --trim-start-samples=2210 --frames=352800
node scripts/music/render-preserve-melody.cjs "$STRUDEL_MODULE" "$CHROME" "$FFMPEG" art/audio/music-export/result --track=result --source=art/audio/strudel-20260926/original/result_sunlit_podium.mp3
```

`--score` 可指定同目录下的其他 `.strudel.js` 文件；不传时按 `--track` 选择表中已采用版本。`--reuse-raw` 仅适用于原音频、旋律素材和乐谱均未变化、只调整母带的情况。脚本只写指定输出目录，不自动替换游戏资源。

乐谱中的 `__MELODIC_BED_URL__` 由脚本替换为本机服务地址，原录音不上传，乐谱不能脱离素材直接在 Strudel 网站播放。

离线渲染使用两个完整循环并截取第二遍，保留跨界混响。语音限额覆盖所有起音事件，避免长采样被提前抢占。导出保留 MP3 延迟与填充信息；赛中首尾只有 3 毫秒防咔哒处理，不能改成长淡入／淡出。替换成品时保留原 `.meta`。

## 验证记录

| 场景 | 报告 | 响度 | 真峰值 |
| --- | --- | --- | --- |
| 赛前 | [arrangement-v4-report.json](../scripts/music/arrangement-v4-report.json) | −16.20 LUFS | −3.51 dBTP |
| 赛中 | [race-arrangement-v1-report.json](../scripts/music/race-arrangement-v1-report.json) | −14.77 LUFS | −1.51 dBTP |
| 结算 | [result-arrangement-v1-report.json](../scripts/music/result-arrangement-v1-report.json) | −13.78 LUFS | −4.23 dBTP |

三份报告记录已接入成品的 SHA-256、解码帧数与旋律频段对照结果。三段原始渲染无削波，周期与完整解码校验通过。噪声音源和混响会使重新渲染的波形略有差异，不要求每次重新导出逐字节相同。

未启动 Cocos Creator，未进行微信 iOS／Android 真机试听。文件级检查不代替设备端循环、音效叠加与最终听感验证。音乐为本地表现，不影响比赛判定或联机同步。
