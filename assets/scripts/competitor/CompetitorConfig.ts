import { shuffleInPlace } from '../core/SharedRNG';

export type AICompetitorProfile = {
    // Single competitiveness axis (0..1). Drives BOTH the release-timing accuracy
    // (how reliably the AI hits the sweet zone) and the stroke cadence (how tight
    // the gap between strokes is). Higher = faster + more accurate. bpmOffset is a
    // small per-lane flavor tweak so equal-difficulty lanes aren't identical.
    difficulty: number;
    bpmOffset: number;
    divePower: number;
    diveReaction: number;
    // Stable racing style (see AI_PERSONALITIES). Gives each lane a recognizable
    // purpose — fast starter, closer, steady pacer, weaver — layered on top of the
    // raw difficulty so opponents no longer feel like interchangeable noise.
    personalityId: AIPersonalityId;
};

// A racing personality. These describe HOW an AI spends its effort over the race
// and how it reacts to the player, on top of its base `difficulty`. All offsets
// are small deltas added to the (already difficulty-based) effort so the effect
// stays a subtle flavor, never a difficulty override.
export type AIPersonality = {
    id: AIPersonalityId;
    label: string;
    // Effort added to difficulty during the opening of the race, fading out by
    // AI_STRATEGY_TUNING.startFadeProgress. Positive = fast/aggressive starter.
    startEffort: number;
    // Effort added to difficulty during the closing stretch, ramping in from
    // AI_STRATEGY_TUNING.finishRampStartProgress. Positive = strong finisher.
    finishEffort: number;
    // Baseline tendency to break clean left/right alternation and weave (0..1),
    // independent of difficulty. High = visibly snaky path; low = swims straight.
    weaveTendency: number;
    // How strongly this AI responds to its gap to the player: rubber-band catch-up
    // when trailing, ease-off when leading, and the neck-and-neck duel surge
    // (0 = ignores the player entirely, 1 = fully reactive).
    competitiveness: number;
};

export type AIPersonalityId =
    | 'frontrunner'
    | 'closer'
    | 'steady'
    | 'sprinter'
    | 'weaver'
    | 'fighter';

export const AI_PERSONALITIES: Record<AIPersonalityId, AIPersonality> = {
    // 领跑型：起步就顶到前面，靠早期领先压制，后程略收。
    frontrunner: { id: 'frontrunner', label: '领跑型', startEffort: 0.12, finishEffort: 0.02, weaveTendency: 0.12, competitiveness: 0.6 },
    // 后程冲刺：前半程留力（略慢），最后一段猛冲，常在终点前反超。
    closer: { id: 'closer', label: '后程冲刺', startEffort: -0.06, finishEffort: 0.16, weaveTendency: 0.1, competitiveness: 0.9 },
    // 稳健匀速：全程节奏平稳、几乎不蛇形，是最"干净"的对手。
    steady: { id: 'steady', label: '稳健匀速', startEffort: 0.02, finishEffort: 0.05, weaveTendency: 0.05, competitiveness: 0.7 },
    // 抢跳快枪：起跳和开局极快，但耐力一般、后程掉速。
    sprinter: { id: 'sprinter', label: '抢跳快枪', startEffort: 0.16, finishEffort: -0.05, weaveTendency: 0.18, competitiveness: 0.5 },
    // 蛇形选手：路线飘、常划歪，喜剧感强，成绩起伏大。
    weaver: { id: 'weaver', label: '蛇形选手', startEffort: 0, finishEffort: 0.03, weaveTendency: 0.5, competitiveness: 0.4 },
    // 缠斗型：紧盯玩家，贴身时最拼，橡皮筋反应最强。
    fighter: { id: 'fighter', label: '缠斗型', startEffort: 0.03, finishEffort: 0.09, weaveTendency: 0.16, competitiveness: 1 },
};

export function getAiPersonality(id: AIPersonalityId): AIPersonality {
    return AI_PERSONALITIES[id] ?? AI_PERSONALITIES.steady;
}

export const DEFAULT_AI_PROFILES: AICompetitorProfile[] = [
    { difficulty: 0.56, bpmOffset: -22, divePower: 0.44, diveReaction: 0.36, personalityId: 'weaver' },
    { difficulty: 0.68, bpmOffset: -14, divePower: 0.56, diveReaction: 0.26, personalityId: 'steady' },
    { difficulty: 0.8, bpmOffset: -4, divePower: 0.72, diveReaction: 0.14, personalityId: 'closer' },
    { difficulty: 0.64, bpmOffset: -18, divePower: 0.5, diveReaction: 0.3, personalityId: 'sprinter' },
    { difficulty: 0.88, bpmOffset: 4, divePower: 0.84, diveReaction: 0.08, personalityId: 'fighter' },
    { difficulty: 0.5, bpmOffset: -28, divePower: 0.38, diveReaction: 0.46, personalityId: 'weaver' },
    { difficulty: 0.82, bpmOffset: -2, divePower: 0.74, diveReaction: 0.13, personalityId: 'frontrunner' },
    { difficulty: 0.9, bpmOffset: 6, divePower: 0.88, diveReaction: 0.07, personalityId: 'closer' },
];

// Preset difficulty tiers offered by the 100m AI-debug 1v1 picker. Value is the
// AISwimmerController.difficulty (0..1) applied to the single opponent.
export const AI_DEBUG_DIFFICULTY_TIERS: { label: string; value: number }[] = [
    { label: '入门 0.30', value: 0.3 },
    { label: '普通 0.50', value: 0.5 },
    { label: '困难 0.70', value: 0.7 },
    { label: '高手 0.85', value: 0.85 },
    { label: '大师 0.98', value: 0.98 },
];

// Tuning for the simulated-input AI. The AI now drives the SAME stroke path as
// the player (press → hold → release), so its propulsion comes entirely from the
// release-timing sweet zone (see STROKE_QUALITY_TUNING). These values only control how
// the AI *simulates* that input as a function of difficulty; the actual sweet-zone
// bounds live in STROKE_QUALITY_TUNING and stay shared with the player.
export const AI_STROKE_TUNING = {
    // Release-progress noise (std dev, in cycle fractions) around the sweet-zone
    // center. Bigger spread = both less-perfect hits and more full misses. Scales
    // from difficulty 0 (sloppy) to difficulty 1 (laser-accurate).
    timingSigmaLow: 0.12,
    timingSigmaHigh: 0.004,
    // Safety ceiling on the simulated release progress. Must stay below the
    // arm-stroke timeout (STROKE_QUALITY_TUNING.armStrokeTimeoutProgress) so a held
    // stroke is always released before the motor force-times-it-out.
    maxReleaseProgress: 0.48,
    // Gap (seconds) between releasing one arm and pressing the opposite arm.
    // High difficulty tightens the gap → higher stroke frequency → more speed.
    gapSecondsSlow: 0.22,
    gapSecondsFast: 0.04,
    // ± random fraction applied to each gap so cadence isn't metronomic.
    gapJitter: 0.28,
    // Randomized delay (seconds) before the first stroke once the race starts.
    startDelayMin: 0.04,
    startDelayMax: 0.2,
    // Fallback: force a release after this many seconds of holding even if the
    // watched progress never reached the target (guards against stalls).
    maxHoldSeconds: 0.6,
};

// Strategy layer tuning. Sits ON TOP of the base difficulty + personality: it
// turns raw randomness into purpose by (1) pacing effort across the race,
// (2) a subtle rubber-band toward the player, and (3) a neck-and-neck duel
// surge. Every value is a small effort delta on the shared difficulty axis so
// the AI never visibly teleports — it just leans a little harder or eases off.
export const AI_STRATEGY_TUNING = {
    // How fast the strategy effort modifier eases toward its live target
    // (per second). Low = invisible, gradual shifts; high = snappy reactions.
    effortEaseRate: 0.8,
    // Rubber-band toward the player. `range` = metres of gap over which the pull
    // saturates; `strength` = max difficulty offset when trailing by a full
    // range. Trailing the player adds effort, leading sheds it by the same curve.
    // Scaled per-AI by personality.competitiveness. Keep small to stay hidden.
    rubberBandRange: 12,
    rubberBandStrength: 0.12,
    // Duel surge: when the player is within `duelRange` metres (ahead OR behind),
    // the AI fights harder to contest/hold the position by up to `duelBoost`.
    duelRange: 4,
    duelBoost: 0.08,
    // Pacing shape. Start boost fades out by `startFadeProgress` of the course;
    // finish boost ramps in from `finishRampStartProgress` to the wall.
    startFadeProgress: 0.35,
    finishRampStartProgress: 0.6,
    // Hard clamps so strategy never pushes an AI to a trivial or hopeless extreme,
    // and an overall cap on the summed modifier so catch-up stays subtle.
    minEffective: 0.08,
    maxEffective: 0.99,
    maxModifier: 0.2,
};

// AI opponents are named by DIFFICULTY TIER so every lane carries a memorable,
// readable identity instead of interchangeable random noise: the weak lanes get
// self-deprecating "here to splash around" names, the mid lanes get solid ordinary
// Chinese names, and the top lanes get names that already sound like a swimming ace.
// Players remember "浪里白条 was the fast one" — the name itself hints at the threat.
export type AiNameTier = {
    // Inclusive upper bound on base profile difficulty for this tier.
    maxDifficulty: number;
    names: string[];
};

export const AI_NAME_TIERS: AiNameTier[] = [
    // 弱（菜鸟）：名字自带喜感，一看就是来划水的。
    {
        maxDifficulty: 0.6,
        names: ['王划水', '李扑通', '张狗刨', '赵慢半拍', '孙漏气', '刘二饼', '周浮板', '吴呛水'],
    },
    // 中坚（普通）：踏实、常见的中国名字。
    {
        maxDifficulty: 0.78,
        names: ['张建军', '李国强', '王志刚', '赵永胜', '陈海涛', '刘大江', '周奋进', '孙拼搏'],
    },
    // 高手 / 大师：名字自带高手气场。
    {
        maxDifficulty: Number.POSITIVE_INFINITY,
        names: ['浪里白条', '陈飞鱼', '水中蛟龙', '赵劈波', '何逐浪', '江疾风', '龙教头', '海霸王'],
    },
];

function aiNameTierIndex(difficulty: number): number {
    for (let i = 0; i < AI_NAME_TIERS.length; i++) {
        if (difficulty <= AI_NAME_TIERS[i].maxDifficulty) {
            return i;
        }
    }
    return AI_NAME_TIERS.length - 1;
}

// Pick a name for each difficulty, preferring the matching tier so the name hints
// at the opponent's skill. Names never repeat within one roster: if a tier runs
// out we spill over to the nearest remaining tier.
export function assignAiNames(difficulties: number[]): string[] {
    const pools = AI_NAME_TIERS.map((tier) => shuffleInPlace(tier.names.slice()));
    return difficulties.map((difficulty) => {
        const preferred = aiNameTierIndex(difficulty);
        for (let distance = 0; distance < pools.length; distance++) {
            for (const index of [preferred - distance, preferred + distance]) {
                if (index >= 0 && index < pools.length && pools[index].length > 0) {
                    return pools[index].pop() as string;
                }
            }
        }
        return 'AI';
    });
}

export type AiRosterEntry = {
    profile: AICompetitorProfile;
    name: string;
};

// Build a freshly randomized roster of `count` AI opponents: the difficulty
// profiles are shuffled (so the exact lineup and its lane order differ every race)
// and each opponent gets a difficulty-appropriate name. Called both at race build
// time and when the player taps "再来一次", so every restart reshuffles opponents
// and their lane positions.
export function buildRandomizedAiRoster(count: number): AiRosterEntry[] {
    const profiles = shuffleInPlace(DEFAULT_AI_PROFILES.slice());
    const chosen: AICompetitorProfile[] = [];
    for (let i = 0; i < count; i++) {
        chosen.push(profiles[i % profiles.length]);
    }
    const names = assignAiNames(chosen.map((profile) => profile.difficulty));
    return chosen.map((profile, i) => ({ profile, name: names[i] }));
}
