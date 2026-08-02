// Tuning for the mid-race "dolphin jump" (海豚跃): both screen halves held
// together launch the swimmer into an exaggerated arc out of the water, ignoring
// drag and collision, then dive back under before resuming the normal swim.
//
// The airborne arc has NO automatic body-axis spin. While airborne, each stroke
// input plays the normal in-water stroke animation and adds one full axial roll
// (left = one way, right = the other); more strokes spin faster. The roll unwinds
// back to the normal swim axis after re-entry.
export const DOLPHIN_JUMP = {
    // Both invisible screen halves must be held together at least this long for
    // the gesture to fire (distinguishes it from a normal two-hand stroke hold).
    triggerHoldSeconds: 0.25,
    // Reject the jump when less than this much course distance remains before the
    // next turn wall or the finish, and keep the whole maneuver this far short of it.
    minAvailableDistance: 3,
    endMargin: 1.0,

    // Brief pre-launch dip below the surface (the porpoise gather).
    dipSeconds: 0.3,
    dipDepth: 0.5,
    dipTiltDegrees: 24,

    // Airborne parabola. Horizontal speed is capped near walls so the arc always
    // lands inside the pool. No drag is applied while airborne.
    launchSpeed: 8.5,
    launchAngleDegrees: 40,
    gravity: 12,

    // Input-driven axial roll: one stroke = one full turn; left rolls one way,
    // right the other. rollEaseRate governs how quickly the body catches up to the
    // accumulated target, so rapid strokes read as a faster corkscrew.
    rollPerStrokeDegrees: 360,
    rollEaseRate: 7,
    // Time to unwind any leftover roll to the normal swim axis after re-entry.
    landingRollUnwindSeconds: 0.45,

    // Landing dive: sink to this depth, hold, then rise back to the surface.
    landingDepth: 0.7,
    landingDescentSeconds: 0.25,
    landingHoldSeconds: 0.3,
    landingRiseSeconds: 0.5,
    landingRiseTiltDegrees: 16,
    // Speed carried out of the re-entry, bled off by the underwater glide drag.
    landingExitSpeed: 3.2,

    // Splash burst sizes: entering the dip (a normal burst), then the big
    // exaggerated surface plumes when leaving the water and re-entering.
    dipSplashScale: 1.2,
    takeoffSplashScale: 2.6,
    landingSplashScale: 3.2,
};
