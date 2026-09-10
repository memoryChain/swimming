export const RIVER_BRAWL_BALANCE = {
    raceDistance: 400,
    // The river course owns its own sampled centre line. The first and last
    // stretches stay straight so the starting blocks and finish presentation
    // remain readable; two broad S bends fill the middle of the 400m run.
    curveStartStraight: 70,
    curveFinishStraight: 70,
    curveCount: 2,
    curveHeadingDegrees: 20.5,
    curveSampleSpacing: 1,
    environmentSampleSpacing: 4,
    flowSpeed: 8.0,
    personalMaxSpeed: 4.0,
    // Only the ordinary pool/base/high-speed drag is scaled. Underwater glide
    // drag remains intact so dives still settle instead of carrying forever.
    personalDragScale: 0.4,
    attackCooldownSeconds: 0.8,
    attackForwardRange: 1.4,
    attackSideMin: 0.7,
    attackSideMax: 3.0,
    attackLateralImpulse: 4.0,
    attackBackwardImpulse: 0.4,
    attackerRecoilImpulse: 0.6,
    // A side kick should wobble a swimmer long enough to read, not reuse the
    // heavy multi-second tumble used by ordinary body collisions.
    attackAxialImpulse: 2.4,
    attackPitchImpulse: 0.8,
    attackSoftnessSide: 0.6,
    attackSoftnessForward: -0.4,
    // The final strip of water behaves like a racing-game runoff zone. Both the
    // shared current and personal propulsion fade toward their contact scales;
    // the athlete stays in the race and never teleports or loses fixed distance.
    bankSlowWidth: 1.5,
    bankFlowSpeedScale: 0.55,
    bankPersonalSpeedScale: 0.25,
    bankImpactSpeedRetention: 0.5,
    bankRecoverySeconds: 0.4,
    bankKnockbackGuardSeconds: 0.4,
    bankGuardOutwardImpulseScale: 0.25,
    aiDecisionIntervalSeconds: 0.25,
    aiCooldownMinSeconds: 1.8,
    aiCooldownMaxSeconds: 3.0,
    aiBankRecoveryInset: 1.5,
    venueEndPadding: 8,
};

// Returns 0 in clear water and 1 when the swimmer's oriented footprint reaches
// the hard bank. Keeping this scalar calculation pure makes it deterministic and
// cheap enough to run for every racer without physics colliders or allocations.
export function riverBankContactRatio(
    outerExtent: number,
    hardHalfWidth: number,
    slowWidth: number,
): number {
    const width = Math.max(0.001, finiteNonNegative(slowWidth));
    const hardEdge = finiteNonNegative(hardHalfWidth);
    const slowStart = Math.max(0, hardEdge - width);
    const linear = clamp01((finiteNonNegative(outerExtent) - slowStart) / width);
    return linear * linear * (3 - 2 * linear);
}

// Bank resistance engages immediately so contact reads on the first frame, but
// releases over a short fixed interval after steering back into clear water.
export function updateRiverBankResistance(
    current: number,
    target: number,
    dt: number,
    recoverySeconds: number,
): number {
    const safeCurrent = clamp01(current);
    const safeTarget = clamp01(target);
    if (safeTarget >= safeCurrent) {
        return safeTarget;
    }
    const seconds = finiteNonNegative(recoverySeconds);
    if (seconds <= 0) {
        return safeTarget;
    }
    return Math.max(safeTarget, safeCurrent - finiteNonNegative(dt) / seconds);
}

function finiteNonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}
