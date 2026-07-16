import { Node } from 'cc';
import { PoolFallbackBuilder } from './PoolFallbackBuilder';
import { PoolSceneLoader } from './PoolSceneLoader';
import { StartBlockInstancer } from './StartBlockInstancer';
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
    private readonly _startBlocks = new StartBlockInstancer();
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
            const hiddenSkyOccluders = hideLegacySkyOccluders(pool);
            if (hiddenSkyOccluders > 0) {
                this._debug?.(`legacy fake sky hidden nodes=${hiddenSkyOccluders}`);
                console.log(`[SpeedSwimming] legacy fake sky hidden nodes=${hiddenSkyOccluders}`);
            }
            this._startBlocks.build(pool, (result) => {
                if (result.error) {
                    console.warn('[SpeedSwimming] dynamic start blocks unavailable', result.error);
                    this._debug?.(`dynamic start blocks unavailable: ${result.error.message}`);
                } else {
                    this._debug?.(`dynamic start blocks=${result.count} batched=${result.batched ? 'yes' : 'no'}`);
                }
                this._debug?.(`pool prefab loaded: ${definition.prefabPath}`);
                done?.({ pool, error: null });
            });
        });
    }
}

function hideLegacySkyOccluders(root: Node): number {
    let hidden = 0;
    const normalized = root.name.toLowerCase();
    if (normalized.includes('night_window') || normalized.includes('deck_sky')) {
        root.active = false;
        hidden += 1;
    }

    for (const child of root.children) {
        hidden += hideLegacySkyOccluders(child);
    }
    return hidden;
}
