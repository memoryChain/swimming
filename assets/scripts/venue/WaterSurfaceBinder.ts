import { Color, Material, MeshRenderer, Node, Vec3, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { WaterSurface } from '../core/WaterSurface';

const LEGACY_WATER_NODE_NAMES = new Set(['PoolWater_0_50', 'PoolWater_50_100']);
const ACTIVE_WATER_NODE_NAMES = new Set(['PoolWaterSurface']);
const WATER_RENDER_PRIORITY = 0;
const WATER_PASS_PRIORITY = 1;
// Lane floats sit above the water line, so the water never actually covers them. Their
// blue cast comes from the lit GLB materials picking up the scene's blue ambient sky
// light. Swap them to unlit materials that keep the original albedo so they render as
// their true red/white/blue/yellow colors.
const LANE_FLOAT_NODE_PREFIX = 'lane_float_rope';

export class WaterSurfaceBinder {
    bind(pool: Node, waterMaterialPath: string, debug?: (message: string) => void) {
        const oldWaterNodes: Node[] = [];
        collectNodesByName(pool, LEGACY_WATER_NODE_NAMES, oldWaterNodes);
        for (const node of oldWaterNodes) {
            node.active = false;
        }

        this.unlitLaneFloats(pool, debug);

        const activeWaterNodes: Node[] = [];
        collectNodesByName(pool, ACTIVE_WATER_NODE_NAMES, activeWaterNodes);
        for (const node of activeWaterNodes) {
            node.active = true;
        }

        if (activeWaterNodes.length <= 0) {
            debug?.('transparent low-poly water skipped: no water nodes');
            return;
        }

        if (!pool.getComponent(WaterSurface)) {
            pool.addComponent(WaterSurface);
        }

        loadRaceAsset(waterMaterialPath, Material, (err, material) => {
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
                    renderer.priority = WATER_RENDER_PRIORITY;
                    renderer.setMaterial(makeRuntimeWaterMaterial(material), 0);
                }
            }
            debug?.(`transparent low-poly water bound nodes=${activeWaterNodes.length}`);
        });
    }

    private unlitLaneFloats(pool: Node, debug?: (message: string) => void) {
        const floatNodes: Node[] = [];
        collectNodesByNamePrefix(pool, LANE_FLOAT_NODE_PREFIX, floatNodes);
        let boundRenderers = 0;
        for (const node of floatNodes) {
            const renderer = node.getComponent(MeshRenderer);
            if (!renderer) {
                continue;
            }
            const sourceMaterials = renderer.sharedMaterials;
            for (let i = 0; i < sourceMaterials.length; i++) {
                const source = sourceMaterials[i];
                if (!source) {
                    continue;
                }
                renderer.setMaterial(makeUnlitLaneFloatMaterial(source), i);
            }
            boundRenderers += 1;
        }
        if (boundRenderers > 0) {
            debug?.(`lane floats set unlit renderers=${boundRenderers}`);
        }
    }
}

// Convert a lit GLB float material into an unlit one that keeps its albedo, so the blue
// ambient sky light no longer tints the lane floats.
function makeUnlitLaneFloatMaterial(source: Material): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = `RuntimeLaneFloat_${source.name || 'Float'}`;
    material.setProperty('mainColor', findMaterialColor(source));
    return material;
}

// GLB standard materials imported by Cocos store the baseColorFactor in `albedoScale`
// (a Vec3/Vec4), while `albedo` stays at the default white. Read albedoScale first so we
// recover the real float color instead of falling back to white.
function findMaterialColor(material: Material): Color {
    const scale = readMaterialProperty(material, 'albedoScale');
    if (scale instanceof Vec4 || scale instanceof Vec3) {
        return new Color(
            clampByte(scale.x * 255),
            clampByte(scale.y * 255),
            clampByte(scale.z * 255),
            255,
        );
    }
    const colorNames = ['albedo', 'mainColor', 'baseColor'];
    for (const name of colorNames) {
        const value = readMaterialProperty(material, name);
        if (value instanceof Color) {
            return value;
        }
    }
    return new Color(255, 255, 255, 255);
}

function readMaterialProperty(material: Material, name: string): unknown {
    try {
        return material.getProperty(name);
    } catch {
        return null;
    }
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function makeRuntimeWaterMaterial(source: Material): Material {
    const material = new Material();
    material.copy(source);
    material.name = 'RuntimePoolWater';
    for (const pass of material.passes ?? []) {
        (pass as any).setPriority?.(WATER_PASS_PRIORITY);
    }
    return material;
}

function collectNodesByName(root: Node, names: Set<string>, out: Node[]) {
    if (names.has(root.name)) {
        out.push(root);
    }
    for (const child of root.children) {
        collectNodesByName(child, names, out);
    }
}

function collectNodesByNamePrefix(root: Node, prefix: string, out: Node[]) {
    if (root.name.startsWith(prefix)) {
        out.push(root);
    }
    for (const child of root.children) {
        collectNodesByNamePrefix(child, prefix, out);
    }
}
