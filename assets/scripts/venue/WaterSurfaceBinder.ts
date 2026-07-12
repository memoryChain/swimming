import { Color, Material, MeshRenderer, Node, Vec3, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { WaterSurface } from '../core/WaterSurface';
import { registerWaterMaterial } from './WaterColorTuning';

const LEGACY_WATER_NODE_NAMES = new Set(['PoolWater_0_50', 'PoolWater_50_100']);
const ACTIVE_WATER_NODE_NAMES = new Set(['PoolWaterSurface']);
const WATER_RENDER_PRIORITY = 0;
const WATER_PASS_PRIORITY = 1;
// Dedicated layer bit for the water surface so the refraction camera can render
// everything under the water WITHOUT drawing the water itself (which would
// self-sample). Bit 8 is a free user layer (Cocos reserves bits 20+).
export const WATER_SURFACE_LAYER = 1 << 8;
// The refraction camera renders ONLY this layer into its RenderTexture: the pool
// floor, bottom lane lines and inner walls. Keeping the deck, starting blocks,
// spectators, lane float ropes and swimmers OUT of the refraction avoids ugly
// double images (those are drawn on top by the main camera) and leaves a clean
// pool bottom to wobble. The main camera renders this layer too, so the floor
// still shows normally.
export const UNDERWATER_LAYER = 1 << 9;
// Swimmers are moved onto this layer so a dedicated "swimmer camera" can draw
// them on top of the opaque refracting water (they'd otherwise be hidden by it).
// The main camera does NOT render this layer; the swimmer camera renders only it.
export const SWIMMER_LAYER = 1 << 10;
// Node-name prefixes of the pool geometry that lives under the water surface.
const UNDERWATER_NODE_PREFIXES = ['pool_floor', 'lane_floor_line', 'lane_t_end', 'pool_tile_grout', 'pool_inner_wall'];
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
        this.assignUnderwaterLayer(pool, debug);

        const activeWaterNodes: Node[] = [];
        collectNodesByName(pool, ACTIVE_WATER_NODE_NAMES, activeWaterNodes);
        for (const node of activeWaterNodes) {
            node.active = true;
            node.layer = WATER_SURFACE_LAYER;
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
                    const runtimeWater = makeRuntimeWaterMaterial(material);
                    registerWaterMaterial(runtimeWater);
                    renderer.setMaterial(runtimeWater, 0);
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

    // Move the pool-bottom geometry onto the underwater layer so the refraction
    // camera can render just this content into its RenderTexture.
    private assignUnderwaterLayer(pool: Node, debug?: (message: string) => void) {
        let moved = 0;
        const walk = (node: Node) => {
            const name = node.name.toLowerCase();
            if (UNDERWATER_NODE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
                node.layer = UNDERWATER_LAYER;
                moved += 1;
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        walk(pool);
        if (moved > 0) {
            debug?.(`underwater layer assigned nodes=${moved}`);
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
