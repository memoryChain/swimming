import { StrokeType } from '../core/GameConstants';
import { RIVER_BRAWL_BALANCE } from '../core/RiverBrawlBalance';
import type { CourseWorldVector } from '../venue/RaceCourseLayout';
import type { Swimmer } from './Swimmer';

export type SideKickResult = {
    attacker: Swimmer;
    target: Swimmer;
    side: StrokeType.LEFT | StrokeType.RIGHT;
};

const _attackForward: CourseWorldVector = { x: 1, y: 0, z: 0 };

export function resolveSideKick(attacker: Swimmer, racers: readonly Swimmer[]): SideKickResult | null {
    if (!attacker.canRiverCombat) {
        return null;
    }
    attacker.getMovementWorldDirection(_attackForward);
    const forwardX = _attackForward.x;
    const forwardZ = _attackForward.z;
    const sideX = -forwardZ;
    const sideZ = forwardX;
    const attackerPosition = attacker.node.position;
    let best: Swimmer | null = null;
    let bestSideOffset = 0;
    let bestSideDistance = Number.POSITIVE_INFINITY;
    let bestForwardDistance = Number.POSITIVE_INFINITY;

    for (const candidate of racers) {
        if (!candidate || candidate === attacker || !candidate.canRiverCombat) {
            continue;
        }
        const dx = candidate.node.position.x - attackerPosition.x;
        const dz = candidate.node.position.z - attackerPosition.z;
        const forwardOffset = dx * forwardX + dz * forwardZ;
        const sideOffset = dx * sideX + dz * sideZ;
        const forwardDistance = Math.abs(forwardOffset);
        const sideDistance = Math.abs(sideOffset);
        if (forwardDistance > RIVER_BRAWL_BALANCE.attackForwardRange
            || sideDistance < RIVER_BRAWL_BALANCE.attackSideMin
            || sideDistance > RIVER_BRAWL_BALANCE.attackSideMax) {
            continue;
        }
        if (sideDistance < bestSideDistance - 1e-5
            || (Math.abs(sideDistance - bestSideDistance) <= 1e-5
                && forwardDistance < bestForwardDistance - 1e-5)) {
            best = candidate;
            bestSideOffset = sideOffset;
            bestSideDistance = sideDistance;
            bestForwardDistance = forwardDistance;
        }
    }
    if (!best) {
        attacker.playCombatKick(StrokeType.LEFT);
        return null;
    }

    const sideSign = bestSideOffset >= 0 ? 1 : -1;
    const weightScale = clamp(Math.sqrt(attacker.weight / best.weight), 0.75, 1.25);
    const lateralMagnitude = RIVER_BRAWL_BALANCE.attackLateralImpulse * weightScale;
    const backwardMagnitude = RIVER_BRAWL_BALANCE.attackBackwardImpulse * weightScale;
    const impulseX = sideX * sideSign * lateralMagnitude - forwardX * backwardMagnitude;
    const impulseZ = sideZ * sideSign * lateralMagnitude - forwardZ * backwardMagnitude;
    best.applyWorldCollisionImpulse(impulseX, impulseZ);
    best.applyCollisionAxialImpulse(-sideSign * RIVER_BRAWL_BALANCE.attackAxialImpulse * weightScale);
    best.applyCollisionPitchImpulse(-RIVER_BRAWL_BALANCE.attackPitchImpulse * weightScale);
    best.applyCollisionSoftnessImpulse(
        sideSign * RIVER_BRAWL_BALANCE.attackSoftnessSide,
        RIVER_BRAWL_BALANCE.attackSoftnessForward,
    );
    best.addCollisionEnergyBonus(lateralMagnitude);
    best.flashCollision();
    best.playCombatImpact();

    const recoilX = -sideX * sideSign * RIVER_BRAWL_BALANCE.attackerRecoilImpulse;
    const recoilZ = -sideZ * sideSign * RIVER_BRAWL_BALANCE.attackerRecoilImpulse;
    attacker.applyWorldCollisionImpulse(recoilX, recoilZ);
    const side = sideSign > 0 ? StrokeType.RIGHT : StrokeType.LEFT;
    attacker.playCombatKick(side);
    return { attacker, target: best, side };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
