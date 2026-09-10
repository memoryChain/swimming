import { randomRange } from '../core/SharedRNG';
import { RIVER_BRAWL_BALANCE } from '../core/RiverBrawlBalance';
import { Swimmer } from './Swimmer';
import { resolveSideKick, SideKickResult } from './SwimmerCombatResolver';

export class RiverCombatController {
    private readonly _cooldowns = new Map<Swimmer, number>();
    private readonly _aiDecisionTimers = new Map<Swimmer, number>();

    reset(racers: readonly Swimmer[]): void {
        this._cooldowns.clear();
        this._aiDecisionTimers.clear();
        for (const swimmer of racers) {
            if (swimmer?.isAI) {
                this._aiDecisionTimers.set(swimmer, RIVER_BRAWL_BALANCE.aiDecisionIntervalSeconds);
            }
        }
    }

    update(dt: number, racers: readonly Swimmer[], edgeHalfWidth: number): void {
        const step = Math.max(0, dt);
        for (const [swimmer, remaining] of this._cooldowns) {
            const next = Math.max(0, remaining - step);
            if (next > 0) this._cooldowns.set(swimmer, next);
            else this._cooldowns.delete(swimmer);
        }
        for (const swimmer of racers) {
            if (!swimmer?.isAI || !swimmer.canRiverCombat) {
                continue;
            }
            let timer = (this._aiDecisionTimers.get(swimmer) ?? 0) - step;
            if (timer > 0) {
                this._aiDecisionTimers.set(swimmer, timer);
                continue;
            }
            timer = RIVER_BRAWL_BALANCE.aiDecisionIntervalSeconds;
            this._aiDecisionTimers.set(swimmer, timer);
            // Bank recovery takes priority even while the AI's attack is cooling
            // down. Otherwise a successful kick made close to shore can leave the
            // attacker scraping the slow zone for the whole cooldown.
            const bankInset = Math.max(0, RIVER_BRAWL_BALANCE.aiBankRecoveryInset);
            const footprint = swimmer.swimBoundaryZRange();
            if (footprint.min <= -edgeHalfWidth + bankInset
                || footprint.max >= edgeHalfWidth - bankInset) {
                swimmer.applyCollisionImpulse(0, swimmer.node.position.z >= 0 ? -0.9 : 0.9);
                continue;
            }
            if (this.cooldownRemaining(swimmer) > 0) {
                continue;
            }
            const result = this.attack(swimmer, racers);
            if (result) {
                this._cooldowns.set(
                    swimmer,
                    randomRange(RIVER_BRAWL_BALANCE.aiCooldownMinSeconds, RIVER_BRAWL_BALANCE.aiCooldownMaxSeconds),
                );
            }
        }
    }

    attack(attacker: Swimmer, racers: readonly Swimmer[]): SideKickResult | null {
        if (!attacker?.canRiverCombat || this.cooldownRemaining(attacker) > 0) {
            return null;
        }
        const result = resolveSideKick(attacker, racers);
        this._cooldowns.set(attacker, RIVER_BRAWL_BALANCE.attackCooldownSeconds);
        return result;
    }

    cooldownRemaining(swimmer: Swimmer): number {
        return this._cooldowns.get(swimmer) ?? 0;
    }
}
