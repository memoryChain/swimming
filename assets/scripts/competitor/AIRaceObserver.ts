import { getRaceDistance } from '../core/GameBalance';
import { Swimmer } from '../entity/Swimmer';

// Shared, read-only view of the live race that every AISwimmerController consults
// to make strategic decisions. One instance is built per race and handed to all
// AI controllers, so rank/gap queries stay cheap (a single pass over the small
// roster) and there is one source of truth for "where is everyone".
//
// The player is the anchor of AI strategy: rubber-band catch-up and the duel
// surge are measured against the player specifically, not the abstract field,
// because this is a player-vs-AI race and the feel that matters is "the pack is
// hunting me / I'm reeling them in".
export class AIRaceObserver {
    constructor(
        private readonly _player: Swimmer | null,
        private readonly _racers: Swimmer[],
    ) {}

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
}
