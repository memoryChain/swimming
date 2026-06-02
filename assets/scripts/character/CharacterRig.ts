import { Color } from 'cc';
import { StrokeType } from '../core/GameConstants';

export interface CharacterRig {
    build(skinColor: Color, suitColor: Color, capColor: Color, robotStyle?: boolean, playerOutline?: boolean): void;
    setActiveSwimming(active: boolean): void;
    setSwimmerColors(skinColor: Color, suitColor: Color, capColor: Color, robotStyle?: boolean, playerOutline?: boolean): void;
    setPreRaceStanding(active: boolean): void;
    triggerArmStroke(): void;
    triggerKick(): void;
    triggerStroke(type: StrokeType): void;
    setStrokeHeld(type: StrokeType, held: boolean): void;
    updateFreestyle(dt: number, leftArmCycle: number, rightArmCycle: number, leftKickCycle: number, rightKickCycle: number, bodyPhase: number, speed: number): void;
    resetPose(): void;
    triggerSplashBurst(scale?: number): void;
}
