// 鲨鱼大乱斗的关卡级调参。鲨鱼属于整场比赛，不属于任何角色技能。
export enum SharkState {
    INACTIVE = 0,
    WARNING = 1,
    HUNT = 2,
    BITE = 3,
    WANDER = 4,
    SATIATED = 5,
}

export const SHARK_TUNING = {
    hungerSchedule: [15, 35, 55] as readonly number[],
    warningSeconds: 3,
    huntOpeningGraceSeconds: 1.1,
    huntSeconds: 8,
    retargetSeconds: 0.5,
    huntSpeed: 4.5,
    wanderSpeed: 1.2,
    maxEliminations: 3,
    collisionRadius: 1.1,
    collisionPushScale: 1.8,
    spawnClearance: 6.5,
    biteMouthForwardOffset: 0.75,
    catchRadius: 0.55,
    bitePresentationSeconds: 0.38,
    biteLungeSpeed: 2.1,
    biteCameraHoldSeconds: 2,
    approachCameraDistance: 3.5,
    waterYOffset: -0.28,
    satiatedSinkOffset: -1.5,
};
