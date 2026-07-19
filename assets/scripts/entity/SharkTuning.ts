// Shark system tuning constants. All shark behaviour magnitudes live here so
// they can be adjusted in one place and optionally surfaced through the debug
// tuning panel later.
//
// Design doc: docs/shark-and-stamina-design.zh.md

export enum SharkState {
    WANDER = 'wander',
    WARNING = 'warning',
    HUNT = 'hunt',
    SATIATED = 'satiated',
}

export const SHARK_TUNING = {
    // Collision radius (metres). Swimmer radius is 0.9, so 1.1 is ~1.2x wider.
    collisionRadius: 1.1,

    // Wander phase: slow random movement that acts as a moving obstacle.
    wanderSpeed: 1.2,
    wanderDirectionChangeInterval: 3.0,

    // Fixed race-time schedule (seconds) at which the shark gets hungry and
    // enters its warning -> hunt beat. Three beats = three dramatic moments at
    // predictable times; after the last beat the shark retires (satiated) so the
    // endgame is shark-free. Times advance only during RACING.
    hungerSchedule: [15.0, 35.0, 55.0],

    // Warning phase: lock-on telegraph before the shark starts hunting.
    warningDuration: 2.5,

    // Hunt phase: chase the nearest swimmer. Slightly faster than swimmer
    // maxSpeed (4.0) so a normal-pace swimmer is caught unless they sprint.
    huntSpeed: 4.5,
    huntTimeout: 8.0,
    huntRetargetInterval: 0.5,

    // How many swimmers the shark can eat before it is satiated.
    maxEliminations: 3,

    // Push strength multiplier relative to swimmer-vs-swimmer collision.
    collisionPushScale: 1.8,

    // Satiated phase: sink to this Y offset below the water surface and stay.
    satiatedSinkOffset: -1.5,

    // Wander tail-sway: small yaw oscillation layered on the heading so the
    // shark looks alive even when its forward speed is slow.
    swayAmplitudeDeg: 6.0,
    swayFrequencyHz: 1.6,
    // Heading ease rate (1/sec) toward the movement direction; low = slow turn.
    headingEaseRate: 4.0,

    // Probability that a hunted AI steers away from the shark on a given stroke
    // (doc: "light evasion" - not guaranteed, so some AI still get caught for
    // comedic effect).
    aiEvasionChance: 0.5,
};
