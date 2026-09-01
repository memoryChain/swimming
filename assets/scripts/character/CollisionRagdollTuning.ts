// Lightweight collision-only active-ragdoll presentation.
//
// These values never feed movement, collision bounds, scoring, or networking.
// They only blend the already-authored freestyle pose toward a loose local-bone
// target after a swimmer collision has disturbed the authoritative root motion.
export const COLLISION_RAGDOLL_TUNING = {
    enabled: 1,

    impactCurlSeconds: 0.08,
    minimumReactionSeconds: 0.12,
    recoverySeconds: 0.28,
    maximumReactionSeconds: 0.8,
    enterAngularSpeedDegrees: 55,
    fullAngularSpeedDegrees: 220,
    snapshotRetriggerDeltaDegrees: 80,
    snapshotRetriggerMaxGapSeconds: 0.35,
    linearImpulseForFullReaction: 2.7,

    // At full intensity, keep this fraction of the current active swim pose.
    // 0.55 means the relaxed collision target owns at most 45% of the bones.
    minimumStrokePoseWeight: 0.45,
    swingFrequencyHz: 1.6,

    armSwingDegrees: 27,
    forearmSwingDegrees: 32,
    elbowBendDegrees: 30,
    legSwingDegrees: 18,
    calfSwingDegrees: 25,
    kneeBendDegrees: 22,
    spineLagDegrees: 4,
    headLagDegrees: 5,

    // Scale-independent head guard: the protected radius is this fraction of
    // the shoulder-to-wrist chain length. Zero disables the guard.
    handHeadGuardArmLengthRatio: 0.28,
};
