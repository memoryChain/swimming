export const RIVER_BRAWL_BALANCE = {
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
    fallSeconds: 0.9,
    respawnSetback: 10,
    respawnSpeed: 1.2,
    respawnProtectionSeconds: 1.25,
    aiDecisionIntervalSeconds: 0.25,
    aiCooldownMinSeconds: 1.8,
    aiCooldownMaxSeconds: 3.0,
    aiEdgeInset: 1.5,
    venueEndPadding: 8,
};
