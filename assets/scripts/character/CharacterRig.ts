import { Color } from 'cc';

export interface CharacterRig {
    build(skinColor: Color, suitColor: Color, capColor: Color, robotStyle?: boolean, playerOutline?: boolean): void;
    setActiveSwimming(active: boolean): void;
    setSwimmerColors(skinColor: Color, suitColor: Color, capColor: Color, robotStyle?: boolean, playerOutline?: boolean): void;
    setPreRaceStanding(active: boolean): void;
    triggerArmStroke(): void;
    triggerKick(): void;
    updateFreestyle(dt: number, armCycle: number, kickCycle: number, bodyPhase: number, speed: number): void;
    resetPose(): void;
    triggerSplashBurst(scale?: number): void;
}
