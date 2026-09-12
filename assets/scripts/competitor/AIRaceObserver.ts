import { getRaceDistance } from '../core/GameBalance';
import { Swimmer } from '../entity/Swimmer';

// 共享赛况只暴露当前可见对手；新策略不以本地玩家为锚点。
export class AIRaceObserver {
    constructor(
        private readonly _player: Swimmer | null,
        private readonly _racers: Swimmer[],
    ) {}

    nearestPhysicalOpponent(swimmer: Swimmer, forwardRange: number, lateralRange: number): Swimmer | null {
        let best: Swimmer | null = null;
        let bestDistance = Infinity;
        const p = swimmer.node.position;
        for (const other of this._racers) {
            if (!other || other === swimmer || !other.node.active || !other.isRacing
                || other.isDolphinJumpActive || other.motor.ability.ignoresSwimmers) continue;
            const dx = Math.abs(other.node.position.x - p.x);
            const dz = Math.abs(other.node.position.z - p.z);
            const metric = dx + dz;
            if (dx <= forwardRange && dz <= lateralRange && (metric < bestDistance || (metric === bestDistance && best && other.node.position.z < best.node.position.z))) {
                best = other; bestDistance = metric;
            }
        }
        return best;
    }

    hasCloseCompetitor(swimmer: Swimmer, range: number): boolean {
        for (const other of this._racers) {
            if (other && other !== swimmer && other.node.active && other.isRacing
                && Math.abs(other.distance - swimmer.distance) <= range) return true;
        }
        return false;
    }

    // Course progress the player has covered (metres along the lane).
    get playerDistance(): number {
        return this._player?.distance ?? 0;
    }

    get raceDistance(): number {
        return getRaceDistance();
    }

    get racerCount(): number {
        return this._racers.length;
    }

    // Signed gap of `distance` relative to the player, in metres. Positive means
    // ahead of the player; negative means trailing.
    gapToPlayer(distance: number): number {
        return distance - this.playerDistance;
    }

    // 1-based rank for a given course distance (1 = current leader). Ties resolve
    // to the better (lower) rank, which is fine for the coarse strategy signal.
    rankForDistance(distance: number): number {
        let ahead = 0;
        for (const racer of this._racers) {
            if (racer && racer.distance > distance) {
                ahead++;
            }
        }
        return ahead + 1;
    }

    // Whether another swimmer sits just ahead of `swimmer` — within `aheadGap`
    // metres along the course AND `lateralGap` metres across (world Z). Used by the
    // expert AI to decide to dolphin-jump OVER a body it is about to overtake.
    hasSwimmerCloseAhead(swimmer: Swimmer, aheadGap: number, lateralGap: number): boolean {
        if (!swimmer) {
            return false;
        }
        const distance = swimmer.distance;
        const z = swimmer.node.position.z;
        for (const other of this._racers) {
            if (!other || other === swimmer || !other.node.active) {
                continue;
            }
            const ahead = other.distance - distance;
            if (ahead > 0 && ahead <= aheadGap && Math.abs(other.node.position.z - z) <= lateralGap) {
                return true;
            }
        }
        return false;
    }
}
