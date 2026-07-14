import { Node, Vec3 } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
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
// Winners face back toward the pool (-X) so they look at the awards camera.
// The model's forward is +X at euler Y=0, so -X is a 180° turn.
const AWARDS_FACING_Y = 180;
const PODIUM_TOP_NODE_NAMES = new Map<number, string>([
    [1, 'award_podium_1'],
    [2, 'award_podium_2'],
    [3, 'award_podium_3'],
]);

export class AwardsPresentation {
    constructor(private readonly _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT) {}

    show(leaderboard: RaceFinishResult[], poolNode?: Node | null): Vec3 {
        const winners = leaderboard
            .filter((row) => row.placement >= 1 && row.placement <= 3 && row.swimmer?.node?.isValid)
            .sort((a, b) => a.placement - b.placement);

        // Confetti particles removed for now (looked like fog); to be reworked later.
        // 礼花粒子暂时移除（之前像一团雾），后续重做。
        return this.presentOnPodium(winners, poolNode) ?? this.presentPoolside(winners);
    }

    hide() {
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
            row.swimmer.presentStanding(position, -90);
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
