import { instantiate, Node, Prefab, resources, Vec3 } from 'cc';
import { pruneNullComponentsRecursive } from '../character/CharacterModelLoader';
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

        resources.load(definition.prefabPath, Prefab, (err, prefab) => {
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
            try {
                pool.setParent(root);
            } catch (error) {
                pool.destroy();
                done({ pool: null, error: error instanceof Error ? error : new Error(`${error}`) });
                return;
            }
            pool.setPosition(Vec3.ZERO);
            pool.setScale(Vec3.ONE);
            done({ pool, error: null });
        });
    }
}
