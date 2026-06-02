import { RACE_DISTANCE } from '../core/GameConstants';

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
    prefabPath: 'pool/PoolScene',
    waterMaterialPath: 'pool/RagingPoolWater',
    laneCount: 8,
    laneWidth: 2.05,
    raceDistance: RACE_DISTANCE,
    startX: 0,
    finishX: RACE_DISTANCE,
};
