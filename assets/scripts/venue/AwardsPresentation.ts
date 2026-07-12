import { Vec3 } from 'cc';
import type { RaceFinishResult } from '../core/RaceManager';
import { DEFAULT_RACE_COURSE_LAYOUT, RaceCourseLayout } from './RaceCourseLayout';

const AWARDS_DECK_MARGIN = 2.4;
const AWARDS_RACER_SPACING = 1.45;

export class AwardsPresentation {
    constructor(private readonly _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT) {}

    show(leaderboard: RaceFinishResult[]): Vec3 {
        const center = new Vec3(
            (this._courseLayout.poolStartX + this._courseLayout.poolFinishX) * 0.5,
            this._courseLayout.platformY,
            -this._courseLayout.poolWidth * 0.5 - AWARDS_DECK_MARGIN,
        );
        const winners = leaderboard
            .filter((row) => row.placement >= 1 && row.placement <= 3 && row.swimmer?.node?.isValid)
            .sort((a, b) => a.placement - b.placement);

        // Temporary no-podium layout: 2nd, 1st, 3rd read naturally from left to
        // right. All three use the standing idle until award animations arrive.
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
