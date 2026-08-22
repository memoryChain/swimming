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
    // A sustained same-side catch must overpower the peak hull-righting moment;
    // otherwise each recovery gap erases the previous lean and roll stalls below
    // the 90° gunwale. Alternating sides still cancel into a controlled rock.
    armCatchTorque: 340,
    // Low-pass response for left/right catch torque. This removes per-stroke
    // angular steps while keeping the body responsive to a changed input side.
    catchTorqueResponseRate: 20,

    // Canoe hull righting-moment curve: -sin(2*roll) creates equal stable wells
    // at prone 0° and supine 180°, with side-on 90° as the unstable gunwale.
    // Power below 1 sharpens the support as the hull starts leaning, so it rocks
    // around either face instead of feeling like one broad linear spring.
    hullRightingTorque: 90,
    hullRightingCurvePower: 0.75,
    // Fast external tumbles overpower the hull. Fading only the restoring moment
    // (not angular drag) preserves collision-launched half/multi-turn rolls.
    hullFadeStartAngularSpeed: 45,
    hullFadeFullAngularSpeed: 120,
    treadWaterProneToleranceDegrees: 20,
    angularDrag: 0.5,
    kickAngularDragPerHz: 0.05,
    // High enough for collision-launched multi-turn tumbles. Normal arm torque is
    // much weaker and remains self-limited by water drag, so it does not hit this cap.
    maxAngularSpeed: 720,

    // Virtual shoulder probes. The raised/out-of-water arm loses catch torque;
    // the submerged opposite arm becomes the effective recovery input.
    shoulderHalfWidth: 0.34,
    shoulderWaterBand: 0.2,
    minimumExposedArmCatch: 0.8,

    // The old procedural phase-driven roll remains only as small shoulder/torso
    // articulation. Whole-body orientation comes from the physics state.
    proceduralRollDegrees: 7,

    // Propulsion loss comes from active tumbling, not absolute body angle. A still
    // prone, supine, or side-on swimmer therefore has no artificial angle penalty;
    // fast angular motion creates temporary hydrodynamic waste until it settles.
    tumblePenaltyStartAngularSpeed: 35,
    tumblePenaltyFullAngularSpeed: 140,
    minForwardScale: 0.22,
};
