import { RACE_COURSE_LENGTH } from '../core/GameBalance';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

export type PoolDefinition = {
    id: string;
    prefabPath?: string;
    waterMaterialPath?: string;
    laneCount: number;
    laneWidth: number;
    raceDistance: number;
    startX: number;
    finishX: number;
    waterY?: number;
    swimY?: number;
    platformBackOffset?: number;
    platformYOffset?: number;
    platformZOffset?: number;
    entryYOffset?: number;
};

export const DEFAULT_POOL_DEFINITION: PoolDefinition = {
    id: 'default-indoor-pool',
    prefabPath: RESOURCE_PATHS.poolPrefab,
    waterMaterialPath: RESOURCE_PATHS.poolWaterMaterial,
    laneCount: 8,
    laneWidth: 2.625,
    raceDistance: RACE_COURSE_LENGTH,
    startX: 0,
    finishX: RACE_COURSE_LENGTH,
    waterY: 0.055,
    swimY: 0,
    platformBackOffset: 1.07,
    platformYOffset: 0.25,
    entryYOffset: 0.04,
};
