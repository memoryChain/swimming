import { RIVER_BRAWL_BALANCE } from '../core/RiverBrawlBalance';
import type { Swimmer } from './Swimmer';

type RiverFallPhase = 'falling' | 'protected';

type RiverFallState = {
    phase: RiverFallPhase;
    remaining: number;
    fallDistance: number;
    start: { x: number; y: number; z: number };
    spinSign: number;
};

export class RiverFallController {
    private readonly _states = new Map<Swimmer, RiverFallState>();

    reset(racers: readonly Swimmer[]): void {
        for (const swimmer of racers) {
            swimmer?.cancelRiverFallState();
        }
        this._states.clear();
    }

    update(dt: number, racers: readonly Swimmer[], edgeHalfWidth: number, raceActive: boolean): void {
        const step = Math.max(0, dt);
        for (const swimmer of racers) {
            if (!swimmer?.node?.isValid) continue;
            const state = this._states.get(swimmer);
            if (state) {
                this.updateState(swimmer, state, step);
                continue;
            }
            if (raceActive && swimmer.canRiverCombat && Math.abs(swimmer.node.position.z) > edgeHalfWidth) {
                this.beginFall(swimmer);
            }
        }
    }

    private beginFall(swimmer: Swimmer): void {
        const position = swimmer.node.position;
        const start = { x: position.x, y: position.y, z: position.z };
        const state: RiverFallState = {
            phase: 'falling',
            remaining: RIVER_BRAWL_BALANCE.fallSeconds,
            fallDistance: swimmer.distance,
            start,
            spinSign: start.z >= 0 ? 1 : -1,
        };
        this._states.set(swimmer, state);
        swimmer.beginRiverFall();
    }

    private updateState(swimmer: Swimmer, state: RiverFallState, dt: number): void {
        state.remaining -= dt;
        if (state.phase === 'falling') {
            const duration = Math.max(0.01, RIVER_BRAWL_BALANCE.fallSeconds);
            const progress = Math.max(0, Math.min(1, 1 - state.remaining / duration));
            swimmer.node.setPosition(
                state.start.x,
                state.start.y - 0.35 * progress - 2.8 * progress * progress,
                state.start.z + state.spinSign * 0.75 * progress,
            );
            swimmer.node.setRotationFromEuler(260 * progress, state.spinSign * 160 * progress, state.spinSign * 220 * progress);
            if (state.remaining > 0) return;
            swimmer.respawnAfterRiverFall(
                Math.max(0, state.fallDistance - RIVER_BRAWL_BALANCE.respawnSetback),
                RIVER_BRAWL_BALANCE.respawnSpeed,
            );
            state.phase = 'protected';
            state.remaining = RIVER_BRAWL_BALANCE.respawnProtectionSeconds;
            swimmer.setRespawnProtectionActive(true);
            return;
        }
        if (state.remaining <= 0) {
            swimmer.setRespawnProtectionActive(false);
            this._states.delete(swimmer);
        }
    }
}
