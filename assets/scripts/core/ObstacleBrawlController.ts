import { OBSTACLE_AI_SAMPLE_SECONDS, obstacleCourseDirection, obstacleCourseX } from './ObstacleBrawlRules';
import type { LitterBrawlController } from './LitterBrawlController';
import type { MinefieldBrawlController } from './MinefieldBrawlController';
import type { ObstaclePlan } from './ObstacleBrawlRules';

export type ObstacleRacer = Readonly<{
    active: boolean;
    finished: boolean;
    distance: number;
    lateral: number;
}>;

/** One owner for both obstacle populations and their shared AI route. */
export class ObstacleBrawlController {
    private targetUrgent = false;
    private aiSampleRemaining = 0;

    constructor(
        readonly plan: ObstaclePlan,
        private readonly poolWidth: number,
        private readonly buoys: MinefieldBrawlController | null,
        private readonly debris: LitterBrawlController | null,
    ) {}

    stopSpawning(authoritative = true): void {
        if (!authoritative) return;
        this.debris?.cancelPendingWaves();
        this.buoys?.cancelUnarmedMines();
    }

    urgentTarget(): boolean { return this.targetUrgent; }

    shouldSampleAi(dt: number): boolean {
        this.aiSampleRemaining -= Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (this.aiSampleRemaining > 0.000001) return false;
        this.aiSampleRemaining = Math.max(0,
            OBSTACLE_AI_SAMPLE_SECONDS + Math.min(0, this.aiSampleRemaining));
        return true;
    }

    targetZForRacer(racer: ObstacleRacer | null): number | null {
        this.targetUrgent = false;
        if (!racer?.active || racer.finished) return null;
        const courseX = obstacleCourseX(racer.distance);
        const direction = obstacleCourseDirection(racer.distance);
        const mines = this.buoys?.mines();
        const litter = this.debris?.clusters();
        let nearby = false;
        let immediateBuoy = false;
        if (mines) for (const mine of mines) {
            const ahead = (mine.courseX - courseX) * direction;
            if (!mine.active || !mine.armed || ahead < -1.5 || ahead > 8) continue;
            nearby = true;
            if (ahead < 5
                && Math.abs(racer.lateral - mine.lateral) < 2.2) immediateBuoy = true;
        }
        if (litter) for (const item of litter) {
            const ahead = (item.courseX - courseX) * direction;
            if (!item.active || item.phase === 'retiring' || ahead < -1.5 || ahead > 9) continue;
            nearby = true;
        }
        if (!nearby) return null;

        const halfWidth = Math.max(0.8, this.poolWidth * 0.5 - 0.9);
        let bestZ = racer.lateral;
        let bestCost = Infinity;
        // Stable bounded candidates. The first candidate preserves the current line.
        for (let index = 0; index <= 12; index++) {
            const z = index === 0 ? racer.lateral : -halfWidth + (2 * halfWidth * (index - 1)) / 11;
            let cost = Math.abs(z - racer.lateral) * 0.22;
            if (mines) for (const mine of mines) {
                const ahead = (mine.courseX - courseX) * direction;
                if (!mine.active || !mine.armed || ahead < -1.5 || ahead > 8) continue;
                const clearance = Math.abs(z - mine.lateral);
                if (clearance < 2.1) cost += (2.1 - clearance) * 18;
            }
            if (litter) for (const item of litter) {
                const ahead = (item.courseX - courseX) * direction;
                if (!item.active || item.phase === 'retiring' || ahead < -1.5 || ahead > 9) continue;
                const clearance = Math.abs(z - item.lateral);
                const radius = item.kind === 'rigid' ? 1.1 : 1.25;
                if (clearance < radius) cost += (radius - clearance)
                    * (item.kind === 'rigid' ? 5 : 1.2);
            }
            if (cost < bestCost) { bestCost = cost; bestZ = z; }
        }
        this.targetUrgent = immediateBuoy;
        return Math.abs(bestZ - racer.lateral) < 0.12 ? null : bestZ;
    }
}
