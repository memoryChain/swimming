import { instantiate, Node, Prefab, resources, Vec3 } from 'cc';
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
            pool.setParent(root);
            pool.setPosition(Vec3.ZERO);
            pool.setScale(Vec3.ONE);
            done({ pool, error: null });
        });
    }
}
