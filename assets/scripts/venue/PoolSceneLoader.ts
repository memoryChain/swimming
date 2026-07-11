import { instantiate, Node, Prefab, Vec3 } from 'cc';
import { pruneNullComponentsInParentChain, pruneNullComponentsRecursive } from '../character/CharacterModelLoader';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { PoolDefinition } from './VenueConfig';

export type PoolSceneLoadResult = {
    pool: Node | null;
    error: Error | null;
};

export class PoolSceneLoader {
    load(root: Node, definition: PoolDefinition, done: (result: PoolSceneLoadResult) => void) {
        if (!definition.prefabPath) {
            done({ pool: null, error: new Error('pool prefab path is empty') });
            return;
        }

        loadRaceAsset(definition.prefabPath, Prefab, (err, prefab) => {
            if (err || !prefab || !root.isValid) {
                done({ pool: null, error: err || new Error(`failed to load ${definition.prefabPath}`) });
                return;
            }

            const pool = instantiate(prefab);
            pool.name = 'LoadedEditablePoolScene';
            const prunedComponents = pruneNullComponentsRecursive(pool);
            if (prunedComponents > 0) {
                console.warn(`[SpeedSwimming] pruned null components from pool prefab count=${prunedComponents}`);
            }
            const prunedParents = pruneNullComponentsInParentChain(root);
            if (prunedParents > 0) {
                console.warn(`[SpeedSwimming] pruned null components from pool parent chain count=${prunedParents}`);
            }
            try {
                pool.setParent(root);
            } catch (error) {
                console.warn('[SpeedSwimming] retry pool prefab attach after component cleanup', error);
                const retryPrunedPool = pruneNullComponentsRecursive(pool);
                const retryPrunedParents = pruneNullComponentsInParentChain(root);
                if (retryPrunedPool + retryPrunedParents > 0) {
                    console.warn(`[SpeedSwimming] retry pruned null components pool=${retryPrunedPool} parents=${retryPrunedParents}`);
                }
                try {
                    pool.setParent(root);
                } catch (retryError) {
                    pool.destroy();
                    done({ pool: null, error: retryError instanceof Error ? retryError : new Error(`${retryError}`) });
                    return;
                }
            }
            pool.setPosition(Vec3.ZERO);
            pool.setScale(Vec3.ONE);
            done({ pool, error: null });
        });
    }
}
