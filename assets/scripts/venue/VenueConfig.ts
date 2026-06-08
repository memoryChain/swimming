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
};

export const DEFAULT_POOL_DEFINITION: PoolDefinition = {
    id: 'default-indoor-pool',
    prefabPath: RESOURCE_PATHS.poolPrefab,
    waterMaterialPath: RESOURCE_PATHS.poolWaterMaterial,
    laneCount: 8,
    laneWidth: 2.05,
    raceDistance: RACE_COURSE_LENGTH,
    startX: 0,
    finishX: RACE_COURSE_LENGTH,
};
