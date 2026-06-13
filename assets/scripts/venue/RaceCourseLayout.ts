import { Vec3 } from 'cc';
import { DIVE_BALANCE } from '../core/GameBalance';
import { DEFAULT_POOL_DEFINITION, PoolDefinition } from './VenueConfig';

const MIN_COURSE_LENGTH = 1;
const DEFAULT_WATER_Y = 0.055;
const DEFAULT_SWIM_Y = 0;

export class RaceCourseLayout {
    readonly startX: number;
    readonly finishX: number;
    readonly laneCount: number;
    readonly laneWidth: number;
    readonly poolWidth: number;
    readonly courseLength: number;
    readonly direction: number;
    readonly waterY: number;
    readonly swimY: number;
    readonly platformBackOffset: number;
    readonly platformYOffset: number;
    readonly platformZOffset: number;
    readonly entryYOffset: number;

    constructor(definition: PoolDefinition) {
        this.startX = definition.startX;
        this.finishX = definition.finishX;
        this.laneCount = definition.laneCount;
        this.laneWidth = definition.laneWidth;
        this.poolWidth = definition.laneCount * definition.laneWidth;
        const delta = definition.finishX - definition.startX;
        this.direction = delta >= 0 ? 1 : -1;
        this.courseLength = Math.max(MIN_COURSE_LENGTH, Math.abs(delta));
        this.waterY = definition.waterY ?? DEFAULT_WATER_Y;
        this.swimY = definition.swimY ?? DEFAULT_SWIM_Y;
        this.platformBackOffset = definition.platformBackOffset ?? Math.abs(DIVE_BALANCE.platformNodeOffset.x);
        this.platformYOffset = definition.platformYOffset ?? DIVE_BALANCE.platformNodeOffset.y;
        this.platformZOffset = definition.platformZOffset ?? DIVE_BALANCE.platformNodeOffset.z;
        this.entryYOffset = definition.entryYOffset ?? 0.02;
    }

    distanceToWorldX(distance: number): number {
        return this.startX + this.direction * this.distanceToCourseOffset(distance);
    }

    directionAtDistance(distance: number): number {
        const lap = Math.floor(Math.max(0, distance) / this.courseLength);
        return lap % 2 === 0 ? this.direction : -this.direction;
    }

    finishDirectionAtDistance(distance: number): number {
        return this.directionAtDistance(Math.max(0, distance - 0.001));
    }

    currentCourseEndDistance(playerDistance: number, raceDistance: number): number {
        const distance = Math.max(0, playerDistance);
        const nextCourseEnd = (Math.floor(distance / this.courseLength) + 1) * this.courseLength;
        return Math.min(raceDistance, nextCourseEnd);
    }

    distanceToCurrentCourseEnd(playerDistance: number, raceDistance: number): number {
        return Math.max(0, this.currentCourseEndDistance(playerDistance, raceDistance) - playerDistance);
    }

    swimPosition(distance: number, z: number): Vec3 {
        return new Vec3(this.distanceToWorldX(distance), this.swimY, z);
    }

    entryPosition(distance: number, z: number): Vec3 {
        return new Vec3(this.distanceToWorldX(distance), this.swimY + this.entryYOffset, z);
    }

    platformPosition(z: number): Vec3 {
        return new Vec3(
            this.startX - this.direction * this.platformBackOffset,
            this.swimY + this.platformYOffset,
            z + this.platformZOffset,
        );
    }

    private distanceToCourseOffset(distance: number): number {
        const lap = Math.floor(Math.max(0, distance) / this.courseLength);
        const lapDistance = Math.max(0, distance) % this.courseLength;
        return lap % 2 === 0 ? lapDistance : this.courseLength - lapDistance;
    }
}

export const DEFAULT_RACE_COURSE_LAYOUT = new RaceCourseLayout(DEFAULT_POOL_DEFINITION);
