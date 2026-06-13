import { Node } from 'cc';
import { PoolFallbackBuilder } from './PoolFallbackBuilder';
import { PoolSceneLoader } from './PoolSceneLoader';
import { PoolDefinition } from './VenueConfig';
import { WaterSurfaceBinder } from './WaterSurfaceBinder';

export type VenueManagerOptions = {
    debug?: (message: string) => void;
};

export type VenueBuildResult = {
    pool: Node | null;
    error: Error | null;
};

export class VenueManager {
    private readonly _loader = new PoolSceneLoader();
    private readonly _fallbackBuilder = new PoolFallbackBuilder();
    private readonly _waterBinder = new WaterSurfaceBinder();
    private readonly _debug?: (message: string) => void;

    constructor(options: VenueManagerOptions = {}) {
        this._debug = options.debug;
    }

    buildPool(root: Node, definition: PoolDefinition, done?: (result: VenueBuildResult) => void) {
        this._loader.load(root, definition, ({ pool, error }) => {
            if (!pool) {
                console.warn(`[SpeedSwimming] failed to load ${definition.prefabPath}, using line-only fallback`, error);
                this._fallbackBuilder.build(root, definition);
                done?.({ pool: null, error });
                return;
            }

            if (definition.waterMaterialPath) {
                this._waterBinder.bind(pool, definition.waterMaterialPath, this._debug);
            }
            this._debug?.(`pool prefab loaded: ${definition.prefabPath}`);
            done?.({ pool, error: null });
        });
    }
}
