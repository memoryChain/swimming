import { Node, Vec3 } from 'cc';
import {
    CHARACTER_ACTION_CONFIG,
    selectActionFromPool,
} from '../character/CharacterActionConfig';
import type { CharacterActionPoolConfig } from '../character/CharacterActionConfig';
import type { RaceFinishResult } from '../core/RaceManager';
import { AwardsConfettiEmitter } from './AwardsConfettiEmitter';
import {
    collectNamedBounds,
    DEFAULT_RACE_COURSE_LAYOUT,
    PLATFORM_STANDING_LIFT,
    RaceCourseLayout,
    SceneBounds,
    STANDING_MODEL_LOCAL_Y,
} from './RaceCourseLayout';

const AWARDS_DECK_MARGIN = 2.4;
const AWARDS_RACER_SPACING = 1.45;
// The podium is beyond the pool's +X finish end. The model's forward is +X at
// euler Y=0, so winners face away from the pool and toward the awards camera.
const AWARDS_FACING_Y = 0;
const PODIUM_TOP_NODE_NAMES = new Map<number, string>([
    [1, 'award_podium_1'],
    [2, 'award_podium_2'],
    [3, 'award_podium_3'],
]);

export class AwardsPresentation {
    private readonly _confetti = new AwardsConfettiEmitter();
    // Swimmers hidden during the ceremony (placements outside the top three).
    private readonly _hiddenSwimmers: Node[] = [];

    constructor(private readonly _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT) {}

    show(leaderboard: RaceFinishResult[], poolNode?: Node | null): Vec3 {
        const winners = leaderboard
            .filter((row) => row.finished && row.placement >= 1 && row.placement <= 3 && row.swimmer?.node?.isValid)
            .sort((a, b) => a.placement - b.placement);

        // Only the medallists take part in the ceremony; hide everyone else so
        // the settlement stage stays focused on the top three.
        this.hideNonWinners(leaderboard);

        this.assignAwardsActions(winners);

        const center = this.presentOnPodium(winners, poolNode) ?? this.presentPoolside(winners);
        const effectParent = poolNode?.isValid ? poolNode : winners[0]?.swimmer.node.parent;
        if (effectParent?.isValid) {
            this._confetti.show(effectParent, center);
        }
        return center;
    }

    hide() {
        this._confetti.hide();
        this.restoreHiddenSwimmers();
    }

    private hideNonWinners(leaderboard: RaceFinishResult[]) {
        this.restoreHiddenSwimmers();
        for (const row of leaderboard) {
            const node = row.swimmer?.node;
            if (!node?.isValid) {
                continue;
            }
            if (row.placement >= 1 && row.placement <= 3 && row.finished) {
                continue;
            }
            if (node.active) {
                node.active = false;
                this._hiddenSwimmers.push(node);
            }
        }
    }

    private restoreHiddenSwimmers() {
        for (const node of this._hiddenSwimmers) {
            if (node?.isValid) {
                node.active = true;
            }
        }
        this._hiddenSwimmers.length = 0;
    }

    update(dt: number) {
        this._confetti.update(dt);
    }

    dispose() {
        this._confetti.dispose();
    }

    private assignAwardsActions(winners: RaceFinishResult[]) {
        for (const row of winners) {
            const pool = awardsActionPool(row.placement);
            const action = pool ? selectActionFromPool(pool.actions) : null;
            if (action) {
                row.swimmer.setShowcaseAction(action);
            }
        }
    }

    // Stand each medallist on their podium step, located from the venue meshes.
    private presentOnPodium(winners: RaceFinishResult[], poolNode?: Node | null): Vec3 | null {
        if (!poolNode?.isValid) {
            return null;
        }
        const tops = new Map<number, SceneBounds>();
        for (const [placement, name] of PODIUM_TOP_NODE_NAMES) {
            const bounds = collectNamedBounds(poolNode, [name]);
            if (bounds) {
                tops.set(placement, bounds);
            }
        }
        if (tops.size === 0) {
            return null;
        }
        for (const row of winners) {
            const bounds = tops.get(row.placement);
            if (!bounds) {
                continue;
            }
            row.swimmer.presentStanding(standingOnBounds(bounds), AWARDS_FACING_Y);
        }
        // Frame on the champion step (podium centre) for the awards camera.
        const champion = tops.get(1) ?? tops.values().next().value;
        return new Vec3(
            (champion.minX + champion.maxX) * 0.5,
            champion.maxY,
            (champion.minZ + champion.maxZ) * 0.5,
        );
    }

    // Fallback used when the podium meshes cannot be located: line the winners
    // up beside the pool so the ceremony still has all three on screen.
    private presentPoolside(winners: RaceFinishResult[]): Vec3 {
        const center = new Vec3(
            (this._courseLayout.poolStartX + this._courseLayout.poolFinishX) * 0.5,
            this._courseLayout.platformY,
            -this._courseLayout.poolWidth * 0.5 - AWARDS_DECK_MARGIN,
        );
        const xOffsetByPlacement = new Map<number, number>([
            [1, 0],
            [2, -AWARDS_RACER_SPACING],
            [3, AWARDS_RACER_SPACING],
        ]);
        for (const row of winners) {
            const position = center.clone();
            position.x += xOffsetByPlacement.get(row.placement) ?? 0;
            // This fallback line-up is on the pool's -Z side, so +Z faces the
            // pool and -Z faces away from it.
            row.swimmer.presentStanding(position, 90);
        }
        return center;
    }
}

function standingOnBounds(bounds: SceneBounds): Vec3 {
    return new Vec3(
        (bounds.minX + bounds.maxX) * 0.5,
        bounds.maxY - STANDING_MODEL_LOCAL_Y + PLATFORM_STANDING_LIFT,
        (bounds.minZ + bounds.maxZ) * 0.5,
    );
}

function awardsActionPool(placement: number): CharacterActionPoolConfig | null {
    if (placement === 1) {
        return CHARACTER_ACTION_CONFIG.awards.champion;
    }
    if (placement === 2) {
        return CHARACTER_ACTION_CONFIG.awards.runnerUp;
    }
    if (placement === 3) {
        return CHARACTER_ACTION_CONFIG.awards.third;
    }
    return null;
}
