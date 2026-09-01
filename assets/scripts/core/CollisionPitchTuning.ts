// Collision-only end-over-end pitch tuning for the lightweight powered ragdoll.
//
// A swimmer is treated as a long floating capsule with an internal sliding mass.
// Longitudinal collision acceleration shifts that mass and injects pitch velocity:
// sudden braking drives the head down, while a shove from behind lifts it. Water
// supplies a single horizontal restoring well plus angular drag, so ordinary
// swimming never creates pitch and every visible disturbance has a collision cause.

export const COLLISION_PITCH_TUNING = {
    enabled: 1,

    // Degrees/second of pitch velocity per 1m/s of inverse-weight-split collision
    // impulse projected onto the swimmer's local forward axis.
    degreesPerLongitudinalImpulse: 320,

    // Water restoring torque toward the normal head-forward horizontal pose.
    // The -sin(pitch) curve permits a hard hit to pass through a full somersault
    // without introducing a second stable feet-forward swimming state.
    rightingTorque: 180,
    angularDrag: 2.4,
    maxAngularSpeed: 540,

    // The ordinary -sin(pitch) righting moment is exactly zero upside-down.
    // A deterministic positive bias near +/-180 degrees moves a nearly stopped
    // swimmer through that dead zone. It is derived only from synced state, so
    // owner/host correction remains sufficient in network races.
    invertedEscapeStartDegrees: 150,
    invertedEscapeMaxAngularSpeed: 45,
    invertedEscapeTorque: 70,

    // A collision-disturbed swimmer must remain in the freestyle pose instead of
    // blending into upright tread water while the root is visibly tilted.
    treadWaterToleranceDegrees: 18,

    // Active pitching wastes propulsion. Angle loss peaks when the long capsule is
    // vertical; angular-speed loss covers fast end-over-end tumbling.
    tumblePenaltyStartAngularSpeed: 35,
    tumblePenaltyFullAngularSpeed: 220,
    minForwardScale: 0.3,
};
