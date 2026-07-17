# AI 对手设计（单局比赛）

> 面向单局比赛的 AI 对手：如何"能游 → 有目的、有策略、三档手感明显不同"。
> 代码位置：`assets/scripts/entity/AISwimmerController.ts`、`assets/scripts/competitor/CompetitorConfig.ts`、`assets/scripts/competitor/AIRaceObserver.ts`、`assets/scripts/core/GameBalance.ts`。
> 所有数值都可在"模型调试"面板的 **AI对手** 组实时调，保存进 `assets/resources/config/tuning.json`。

## 1. 核心原则

- **AI 和玩家共用同一套划水机制**：AI 不是"直接给速度"，而是模拟玩家的 `按下 → 保持 → 松手` 划水路径，推进力全部来自松手时机落在甜区（`STROKE_QUALITY_TUNING`）。所以 AI 的强弱和玩家是同一把尺子，公平可信。
- **分层设计**：难度基线 → 性格 → 策略 → 难度档位缩放。每一层只做一件事，互不覆盖。
- **追赶要"隐形"**：橡皮筋/缠斗都是在难度轴上叠加一个**小而平滑**的发力修正，绝不瞬移、不硬拉速度。

```
最终发力 = clamp( 基线difficulty × 档位倍率 + 策略修正 , 0.08 , 0.99 )
                    └── 每条泳道 ──┘  └ 档位 ┘   └ 性格配速 + 橡皮筋 + 缠斗 ┘
```

## 2. 第一层：难度基线（每条泳道）

每条泳道有一个固定的 `difficulty`（0–1），只影响两件事：
- **松手精度**：越高越稳命中甜区（`timingSigma` 随难度收窄）。
- **划频**：越高划水间隔越短、游得越快（`gapSeconds` 随难度收紧）。

阵容（`DEFAULT_AI_PROFILES`，按泳道循环取用）：

| 泳道基线 difficulty | 绑定性格 |
|------|------|
| 0.56 | 蛇形选手 weaver |
| 0.68 | 稳健匀速 steady |
| 0.80 | 后程冲刺 closer |
| 0.64 | 抢跳快枪 sprinter |
| 0.88 | 缠斗型 fighter |
| 0.50 | 蛇形选手 weaver |
| 0.82 | 领跑型 frontrunner |
| 0.90 | 后程冲刺 closer |

## 3. 第二层：性格（对手差异）

性格决定 AI **怎么花力气**和**多在意玩家**，三档共用、每条泳道固定。定义在 `AI_PERSONALITIES`。

| 性格 | 起步发力 | 后程冲刺 | 蛇形倾向 | 竞争性 | 玩家感受 |
|------|------|------|------|------|------|
| 领跑型 frontrunner | +0.12 | +0.02 | 0.12 | 0.6 | 起步就顶到前面，靠早期领先压制 |
| 后程冲刺 closer | −0.06 | +0.16 | 0.10 | 0.9 | 前半程留力，最后一段猛冲、常终点前反超 |
| 稳健匀速 steady | +0.02 | +0.05 | 0.05 | 0.7 | 全程平稳、几乎不蛇形，最"干净"的对手 |
| 抢跳快枪 sprinter | +0.16 | −0.05 | 0.18 | 0.5 | 起跳开局极快，但后程掉速 |
| 蛇形选手 weaver | 0 | +0.03 | 0.50 | 0.4 | 路线飘、常划歪，喜剧感强、起伏大 |
| 缠斗型 fighter | +0.03 | +0.09 | 0.16 | 1.0 | 紧盯玩家，贴身时最拼、橡皮筋反应最强 |

- **起步发力 / 后程冲刺**：赛程前段（`startFadeProgress=0.35` 前）叠加起步发力，后段（`finishRampStartProgress=0.6` 后）叠加冲刺发力 → 形成配速节奏。
- **蛇形倾向**：独立于难度的基线"划歪"概率，让路线成为可辨识的风格；发力越猛越收敛。
- **竞争性**：橡皮筋和缠斗按它缩放（0 = 无视玩家，1 = 全力反应）。

## 4. 第三层：策略（针对玩家的实时反应）

AI 通过共享的 `AIRaceObserver` 读到自己相对**玩家**的距离差（`gapToPlayer`），据此实时调整发力。参数在 `AI_STRATEGY_TUNING`，反应经过平滑（`effortEaseRate=0.8`）所以是渐变、隐形的。

- **橡皮筋 rubber-band**：落后玩家 → 加力追赶；领先玩家 → 收力。
  - 公式：`-clamp(gap/rubberBandRange, -1, 1) × rubberBandStrength × 竞争性 × 档位倍率`
  - 基准：`rubberBandRange=12m`，`rubberBandStrength=0.12`。
- **贴身缠斗 duel**：玩家在 `duelRange=4m` 内时额外发力（`duelBoost=0.08`），制造你追我赶。
- **配速 pacing**：即第 3 节的起步/冲刺发力。
- 三者相加后被 `maxModifier=0.2` 封顶，确保追赶始终"隐形"、不喧宾夺主。

## 5. 第四层：三个难度档位（明显不同的手感）

档位定义在 `RACE_DIFFICULTY_OPTIONS`。除了整体快慢（`aiDifficultyScale`），还分别缩放**追赶、缠斗、蛇形**三项策略，让三档的"脾气"不同，而不只是"更快"。

| 档位 | AI倍率<br>(快慢·手稳) | 追赶<br>rubberBandScale | 缠斗<br>duelScale | 蛇形<br>weaveScale |
|------|:---:|:---:|:---:|:---:|
| **入门 beginner** | 0.60 | 0.35 | 0.30 | 1.60 |
| **竞技 competitive** | 0.82 | 1.00 | 1.00 | 1.00 |
| **世锦赛 championship** | 1.00 | 1.60 | 1.70 | 0.45 |

**玩家会明显感受到：**
- **入门**：对手整体慢、爱划歪犯错、你一旦领先基本甩得掉 → 轻松领先、容错高。
- **竞技**：均衡基准，你追我赶但公平，考验稳定发挥。
- **世锦赛**：对手快、路线干净专业，你领先也会被反复追平、贴身死拼 → 甩不掉，要真发挥才能赢。

各泳道基线 difficulty 经 `aiDifficultyScale` 缩放后的实际难度：

| 泳道基线 | 入门 ×0.60 | 竞技 ×0.82 | 世锦赛 ×1.0 |
|:---:|:---:|:---:|:---:|
| 0.50 | 0.30 | 0.41 | 0.50 |
| 0.56 | 0.34 | 0.46 | 0.56 |
| 0.64 | 0.38 | 0.52 | 0.64 |
| 0.68 | 0.41 | 0.56 | 0.68 |
| 0.80 | 0.48 | 0.66 | 0.80 |
| 0.82 | 0.49 | 0.67 | 0.82 |
| 0.88 | 0.53 | 0.72 | 0.88 |
| 0.90 | 0.54 | 0.74 | 0.90 |

## 6. 调参入口

模型调试面板 → **AI对手** 组（id 前缀 `ai.*` / `aiStrategy.*` / `difficulty.*`），改完保存进 `tuning.json`，正式比赛加载生效。

- **整体快慢/手稳**：`ai.timingSigma*`、`ai.gapSeconds*`；每档 `difficulty.<档>.aiDifficultyScale`。
- **追赶手感**：`aiStrategy.rubberBandStrength/Range`、`aiStrategy.duelBoost/Range`、`aiStrategy.maxModifier`、`aiStrategy.effortEaseRate`。
- **配速节奏**：`aiStrategy.startFadeProgress`、`aiStrategy.finishRampStartProgress`。
- **三档差异**：每档 `difficulty.<档>.rubberBandScale / duelScale / weaveScale`。
- **性格阵容**：直接改 `CompetitorConfig.ts` 的 `AI_PERSONALITIES` 与 `DEFAULT_AI_PROFILES`（非运行时滑块）。

## 7. 调优建议（顺序）

1. 先用**竞技**档把基准调到"正常发挥能赢、失误会输"。
2. 再调**入门/世锦赛**的三个 scale，拉开区分度（入门更松、世锦赛更咬）。
3. 最后微调 `AI_PERSONALITIES`，让每条泳道的风格辨识度更强（如让 closer 的后程反超更戏剧）。
