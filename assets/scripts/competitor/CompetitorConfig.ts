export type AICompetitorProfile = {
    // Single competitiveness axis (0..1). Drives BOTH the release-timing accuracy
    // (how reliably the AI hits the sweet zone) and the stroke cadence (how tight
    // the gap between strokes is). Higher = faster + more accurate. bpmOffset is a
    // small per-lane flavor tweak so equal-difficulty lanes aren't identical.
    difficulty: number;
    bpmOffset: number;
    divePower: number;
    diveReaction: number;
};

export const DEFAULT_AI_PROFILES: AICompetitorProfile[] = [
    { difficulty: 0.56, bpmOffset: -22, divePower: 0.44, diveReaction: 0.36 },
    { difficulty: 0.68, bpmOffset: -14, divePower: 0.56, diveReaction: 0.26 },
    { difficulty: 0.8, bpmOffset: -4, divePower: 0.72, diveReaction: 0.14 },
    { difficulty: 0.64, bpmOffset: -18, divePower: 0.5, diveReaction: 0.3 },
    { difficulty: 0.88, bpmOffset: 4, divePower: 0.84, diveReaction: 0.08 },
    { difficulty: 0.5, bpmOffset: -28, divePower: 0.38, diveReaction: 0.46 },
    { difficulty: 0.82, bpmOffset: -2, divePower: 0.74, diveReaction: 0.13 },
    { difficulty: 0.9, bpmOffset: 6, divePower: 0.88, diveReaction: 0.07 },
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

export const AI_COMPETITOR_NAMES = [
    'Liam',
    'Noah',
    'Oliver',
    'James',
    'Lucas',
    'Mason',
    'Ethan',
    'Logan',
    'Henry',
    'Jack',
    'Owen',
    'Leo',
    'Miles',
    'Caleb',
    'Dylan',
    'Finn',
];

export function shuffledAiCompetitorNames(): string[] {
    const names = AI_COMPETITOR_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = names[i];
        names[i] = names[j];
        names[j] = temp;
    }
    return names;
}
