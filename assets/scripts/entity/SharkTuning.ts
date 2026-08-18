// Global shark-summon tuning. These values deliberately live outside the skill
// runtime: one shark belongs to the race, not to an individual swimmer.
export enum SharkState {
    INACTIVE = 0,
    WARNING = 1,
    HUNT = 2,
    // The race result is already committed, but the predator remains visible
    // briefly so the contact reads as a real attack instead of two pop-outs.
    BITE = 3,
}

export const SHARK_TUNING = {
    // The warning must buy a real escape window, rather than merely showing an
    // icon while a shark has already spawned in catch range.
    warningSeconds: 3,
    huntOpeningGraceSeconds: 1.1,
    huntSeconds: 8,
    retargetSeconds: 0.5,
    huntSpeed: 4.5,
    spawnClearance: 6.5,
    // The art root is the body centre. Move the hit point to the mouth so a
    // swimmer cannot be eliminated by a tail or an invisible centre-radius ring.
    biteMouthForwardOffset: 0.75,
    catchRadius: 0.55,
    bitePresentationSeconds: 0.38,
    biteLungeSpeed: 2.1,
    biteCameraHoldSeconds: 2,
    approachCameraDistance: 3.5,
    waterYOffset: -0.28,
};
