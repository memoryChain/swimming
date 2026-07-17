import { BatchingUtility, instantiate, Node, Prefab, Vec3 } from 'cc';
import { pruneNullComponentsRecursive } from '../character/CharacterModelLoader';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

const ANCHOR_ROOT_NAME = 'start_block_anchor_root';
const ANCHOR_PREFIX = 'start_block_anchor_';
// Only the near (starting) end is instanced. The far end is never approached by
// swimmers in a one-way sprint, so those 8 blocks are dropped to halve the
// start-block vertex load.
const ANCHOR_NAME_PATTERN = /^start_block_anchor_near_\d{2}$/;
// Keep rendered instances out of RaceCourseLayout's contact-surface lookup.
// Their highest vertex is a raised rear detail, not the deck where swimmers
// plant their feet. The dedicated start_block_top_near_marker owns that height.
const RUNTIME_BLOCK_PREFIX = 'runtime_start_block_';
const BATCH_ROOT_NAME = 'RuntimeStartBlocksBatch';

export type StartBlockBuildResult = {
    count: number;
    batched: boolean;
    error: Error | null;
};

// Loads one high-detail start-block mesh and reuses it at the exact placement
// anchors exported by LowPolyPool.glb. All prefab instances share the same mesh,
// material and texture assets. Static batching then folds the 16 renderers into
// one runtime draw while preserving every anchor's world transform.
export class StartBlockInstancer {
    // The node that actually holds the rendered start-block geometry: the static
    // batch root when batching succeeded, otherwise the anchor root that still
    // parents the per-anchor instances. Toggling it lets the race hide the whole
    // set (they are only visible at the dive end and never seen mid-race).
    private _renderRoot: Node | null = null;

    setVisible(visible: boolean) {
        if (this._renderRoot?.isValid) {
            this._renderRoot.active = visible;
        }
    }

    build(pool: Node, done: (result: StartBlockBuildResult) => void) {
        const anchorRoot = findNodeByName(pool, ANCHOR_ROOT_NAME);
        if (!anchorRoot) {
            done({ count: 0, batched: false, error: new Error(`missing ${ANCHOR_ROOT_NAME}`) });
            return;
        }

        const anchors: Node[] = [];
        collectAnchors(anchorRoot, anchors);
        anchors.sort((a, b) => a.name.localeCompare(b.name));
        if (anchors.length <= 0) {
            done({ count: 0, batched: false, error: new Error('start-block placement anchors are empty') });
            return;
        }

        loadFirstStartBlockPrefab(RESOURCE_PATHS.startBlockPrefabCandidates, (error, prefab, loadedPath) => {
            if (error || !prefab || !pool.isValid || !anchorRoot.isValid) {
                done({
                    count: 0,
                    batched: false,
                    error: error ?? new Error('failed to load start-block prefab'),
                });
                return;
            }

            let count = 0;
            for (const anchor of anchors) {
                if (!anchor.isValid) {
                    continue;
                }
                const block = instantiate(prefab);
                block.name = anchor.name.replace(ANCHOR_PREFIX, RUNTIME_BLOCK_PREFIX);
                pruneNullComponentsRecursive(block);
                block.setParent(anchor);
                block.setPosition(Vec3.ZERO);
                block.setRotationFromEuler(0, 0, 0);
                block.setScale(Vec3.ONE);
                count += 1;
            }

            const batchRoot = count > 0 ? batchStartBlocks(anchorRoot, pool) : null;
            const batched = batchRoot !== null;
            this._renderRoot = batchRoot ?? anchorRoot;
            console.log(`[SpeedSwimming] dynamic start blocks=${count} batched=${batched ? 'yes' : 'no'} prefab=${loadedPath}`);
            done({ count, batched, error: null });
        });
    }
}

function loadFirstStartBlockPrefab(
    candidates: readonly string[],
    done: (error: Error | null, prefab?: Prefab, loadedPath?: string) => void,
) {
    let index = 0;
    let lastError: Error | null = null;
    const tryNext = () => {
        if (index >= candidates.length) {
            done(lastError ?? new Error('start-block prefab candidates are empty'));
            return;
        }
        const path = candidates[index++];
        loadRaceAsset(path, Prefab, (error, prefab) => {
            if (error || !prefab) {
                lastError = error ?? new Error(`failed to load ${path}`);
                tryNext();
                return;
            }
            done(null, prefab, path);
        });
    };
    tryNext();
}

function batchStartBlocks(anchorRoot: Node, pool: Node): Node | null {
    const batchRoot = new Node(BATCH_ROOT_NAME);
    batchRoot.layer = anchorRoot.layer;
    batchRoot.setParent(anchorRoot.parent ?? pool);
    batchRoot.setPosition(Vec3.ZERO);
    batchRoot.setRotationFromEuler(0, 0, 0);
    batchRoot.setScale(Vec3.ONE);
    try {
        if (BatchingUtility.batchStaticModel(anchorRoot, batchRoot)) {
            return batchRoot;
        }
    } catch (error) {
        console.warn('[SpeedSwimming] start-block static batching failed; keeping shared instances', error);
    }
    batchRoot.destroy();
    return null;
}

function findNodeByName(root: Node, name: string): Node | null {
    if (root.name.toLowerCase() === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findNodeByName(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

function collectAnchors(root: Node, out: Node[]) {
    if (ANCHOR_NAME_PATTERN.test(root.name.toLowerCase())) {
        out.push(root);
    }
    for (const child of root.children) {
        collectAnchors(child, out);
    }
}
