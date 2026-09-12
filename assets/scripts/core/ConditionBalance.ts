// 体力只按划水次数消耗；心率仅驱动显示，不参与判定和推进。
import { RacePhase } from '../condition/ConditionTypes';

export const RACE_PHASE_BALANCE = {
    sprintDistanceFromFinish: 25,
};

export const CONDITION_BALANCE = {
    energy: {
        total: 100,
        drainPerStroke: 1,
        exhaustedPropulsionScale: 0.5,
    },
    heartRate: {
        // Equilibrium model (physiological 0..200 scale): HR continuously eases
        // toward a target driven by sustained effort. Steady controlled effort settles
        // in the OPTIMAL sweet zone (110-150); only over-driving climbs into
        // HIGH_PRESSURE / OVERLOAD. Replaces the old one-way ratchet.
        restTargetHr: 70,         // resting HR with no effort (drifts down to here)
        maxEffortTargetHr: 140,   // perfect steady effort settles high in OPTIMAL (sweet zone)
        effortDecayPerSecond: 0.35, // sustained-effort sample fade rate when not stroking
        easeUpPerSecond: 16,      // climb rate when HR is below target (HR points/sec)
        easeDownPerSecond: 6,     // recovery rate when HR is above target

        // Startup wobble window: first N strokes use DiveResult.heartRateStartupWobbleModifier.
        startupStrokeWindow: 5,
    },

};

// 比赛阶段只改变心率的显示走势。
export const CONDITION_PHASE_TUNING: Record<RacePhase, { hrPushScale: number; hrDriftScale: number }> = {
    [RacePhase.START]: { hrPushScale: 1.0, hrDriftScale: 0.8 },
    [RacePhase.PACE]: { hrPushScale: 1.0, hrDriftScale: 1.0 },
    [RacePhase.SPRINT]: { hrPushScale: 1.5, hrDriftScale: 0.6 },
    [RacePhase.RESULT]: { hrPushScale: 0.0, hrDriftScale: 1.5 },
};

// 保留共享接口，供本地玩家、AI 和远端 owner 状态使用。
export function conditionEfficiencyScale(energyRatio: number): number {
    return Number.isFinite(energyRatio) && energyRatio <= 0
        ? Math.max(0, Math.min(1, CONDITION_BALANCE.energy.exhaustedPropulsionScale))
        : 1;
}

export function conditionQualityScale(_heartRate: number): number {
    return 1;
}

export function energyDepletionCadenceScale(_energyRatio: number): number {
    return 1;
}


// 小数消耗和网络比例还原可能留下极小浮点余数，不能因此多获得一划满力。
export function energyAfterStrokes(energy: number, count: number): number {
    const remaining = energy - Math.max(0, Math.floor(count)) * Math.max(0, CONDITION_BALANCE.energy.drainPerStroke);
    return remaining <= 1e-8 ? 0 : remaining;
}
