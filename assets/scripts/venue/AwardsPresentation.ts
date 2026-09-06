import { Node, Vec3 } from 'cc';
import {
    CHARACTER_ACTION_CONFIG,
    selectActionFromPool,
} from '../character/CharacterActionConfig';
import type { CharacterActionPoolConfig } from '../character/CharacterActionConfig';
import type { RaceFinishResult } from '../core/RaceManager';
import { AwardsConfettiEmitter } from './AwardsConfettiEmitter';
import { AwardsLighting } from './AwardsLighting';
import { awardsPodiumSurface } from './AwardsPodiumSurface';
import {
    DEFAULT_RACE_COURSE_LAYOUT,
    RaceCourseLayout,
    SceneBounds,
    STANDING_MODEL_LOCAL_Y,
} from './RaceCourseLayout';

const AWARDS_DECK_MARGIN = 2.4;
const AWARDS_RACER_SPACING = 1.45;
// 仅留 2mm 防止鞋底与台面重叠，由各角色的真实蒙皮鞋底完成接地。
const AWARDS_SHOE_CLEARANCE = 0.002;
const PODIUM_TOP_NODE_NAMES = new Map<number, string>([
    [1, 'award_podium_1'],
    [2, 'award_podium_2'],
    [3, 'award_podium_3'],
]);

export class AwardsPresentation {
    private readonly _confetti = new AwardsConfettiEmitter();
    private readonly _lighting = new AwardsLighting();
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

        const center = this.presentOnPodium(winners, poolNode) ?? this.presentPoolside(winners, poolNode);
        this._lighting.show(winners.map(row => row.swimmer.node));
        const effectParent = poolNode?.isValid ? poolNode : winners[0]?.swimmer.node.parent;
        if (effectParent?.isValid) {
            this._confetti.show(effectParent, center);
        }
        return center;
    }

    hide() {
        this._confetti.hide();
        this._lighting.hide();
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
        this._lighting.hide();
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
            const bounds = awardsPodiumSurface(poolNode, name);
            if (bounds) {
                tops.set(placement, bounds);
            }
        }
        if (tops.size === 0 || winners.some(row => !tops.has(row.placement))) {
            return null;
        }
        const poolCenterX = (this._courseLayout.poolStartX + this._courseLayout.poolFinishX) * 0.5;
        for (const row of winners) {
            const bounds = tops.get(row.placement);
            if (!bounds) {
                continue;
            }
            const position = standingOnBounds(bounds);
            // Keep winners facing away from the pool and toward the awards camera,
            // regardless of whether the podium is authored beyond -X or +X.
            const facingY = position.x < poolCenterX ? 180 : 0;
            row.swimmer.presentStanding(position, facingY, bounds.maxY + AWARDS_SHOE_CLEARANCE);
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
    private presentPoolside(winners: RaceFinishResult[], poolNode?: Node | null): Vec3 {
        const ground = poolNode?.isValid ? awardsPodiumSurface(poolNode, 'Venue_Rectangular_Ground') : null;
        const surfaceY = ground?.maxY ?? this._courseLayout.platformY + STANDING_MODEL_LOCAL_Y;
        const center = new Vec3(
            this._courseLayout.poolStartX - this._courseLayout.direction * AWARDS_DECK_MARGIN,
            surfaceY - STANDING_MODEL_LOCAL_Y,
            0,
        );
        const zOffsetByPlacement = new Map<number, number>([
            [1, 0],
            [2, AWARDS_RACER_SPACING],
            [3, -AWARDS_RACER_SPACING],
        ]);
        for (const row of winners) {
            const position = center.clone();
            position.z += zOffsetByPlacement.get(row.placement) ?? 0;
            const facingY = this._courseLayout.direction > 0 ? 180 : 0;
            row.swimmer.presentStanding(position, facingY, surfaceY + AWARDS_SHOE_CLEARANCE);
        }
        return center;
    }
}

function standingOnBounds(bounds: SceneBounds): Vec3 {
    return new Vec3(
        (bounds.minX + bounds.maxX) * 0.5,
        bounds.maxY - STANDING_MODEL_LOCAL_Y,
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
