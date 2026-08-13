// Global shark-summon tuning. These values deliberately live outside the skill
// runtime: one shark belongs to the race, not to an individual swimmer.
export enum SharkState {
    INACTIVE = 0,
    WARNING = 1,
    HUNT = 2,
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
    catchRadius: 1.95,
    waterYOffset: -0.28,
};
