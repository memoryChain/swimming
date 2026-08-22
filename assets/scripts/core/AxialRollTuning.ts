// Powered long-axis roll tuning for surface freestyle.
//
// The swimmer is not snapped to a requested bank angle. Each underwater arm
// catch produces torque around the head-to-feet axis, water buoyancy tries to
// create two stable orientations (prone and supine), and angular drag removes
// energy. Alternating arms cancel naturally around either balance state;
// repeating one side can carry the swimmer across the unstable side-on region.

export const AXIAL_ROLL_TUNING = {
    enabled: 1,

    // Continuous torque while an arm is inside the effective underwater pull.
    armCatchTorque: 220,
    // Low-pass response for left/right catch torque. This removes per-stroke
    // angular steps while keeping the body responsive to a changed input side.
    catchTorqueResponseRate: 20,

    // Canoe-like double-well stability curve. Prone (0°) and supine (180°) are
    // both stable; the side-on region between them is the capsize transition.
    waterRightingTorque: 24,
    tippingStartDegrees: 20,
    tippingFullDegrees: 50,
    capsizeTorque: 90,
    angularDrag: 0.5,
    kickAngularDragPerHz: 0.05,
    maxAngularSpeed: 230,

    // Virtual shoulder probes. The raised/out-of-water arm loses catch torque;
    // the submerged opposite arm becomes the effective recovery input.
    shoulderHalfWidth: 0.34,
    shoulderWaterBand: 0.2,
    minimumExposedArmCatch: 0.8,

    // The old procedural phase-driven roll remains only as small shoulder/torso
    // articulation. Whole-body orientation comes from the physics state.
    proceduralRollDegrees: 7,

    // Distance from the nearest stable face wastes propulsion. Supine recovers
    // full efficiency; the side-on transition is slowest.
    speedPenaltyStartDegrees: 32,
    speedPenaltyFullDegrees: 72,
    minForwardScale: 0.22,
};
