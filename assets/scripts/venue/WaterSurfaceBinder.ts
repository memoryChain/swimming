import { Material, MeshRenderer, Node, resources } from 'cc';
import { WaterSurface } from '../core/WaterSurface';

const LEGACY_WATER_NODE_NAMES = new Set(['PoolWater_0_50', 'PoolWater_50_100']);
const ACTIVE_WATER_NODE_NAMES = new Set(['flat_transparent_water_plane']);

export class WaterSurfaceBinder {
    bind(pool: Node, waterMaterialPath: string, debug?: (message: string) => void) {
        const oldWaterNodes: Node[] = [];
        collectNodesByName(pool, LEGACY_WATER_NODE_NAMES, oldWaterNodes);
        for (const node of oldWaterNodes) {
            node.active = false;
        }

        const activeWaterNodes: Node[] = [];
        collectNodesByName(pool, ACTIVE_WATER_NODE_NAMES, activeWaterNodes);
        for (const node of activeWaterNodes) {
            node.active = true;
        }

        if (!pool.getComponent(WaterSurface)) {
            pool.addComponent(WaterSurface);
        }

        resources.load(waterMaterialPath, Material, (err, material) => {
            if (err || !material || !pool.isValid) {
                console.warn('[SpeedSwimming] failed to load transparent pool water material', err);
                return;
            }
            for (const node of activeWaterNodes) {
                if (!node.isValid) {
                    continue;
                }
                const renderer = node.getComponent(MeshRenderer);
                if (renderer) {
                    renderer.setMaterial(material, 0);
                }
            }
            debug?.(`transparent low-poly water bound nodes=${activeWaterNodes.length}`);
        });
    }
}

function collectNodesByName(root: Node, names: Set<string>, out: Node[]) {
    if (names.has(root.name)) {
        out.push(root);
    }
    for (const child of root.children) {
        collectNodesByName(child, names, out);
    }
}
