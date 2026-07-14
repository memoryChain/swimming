import { Color, Material, MeshRenderer, Node, Texture2D, Vec3, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { WaterSurface } from '../core/WaterSurface';
import { registerWaterMaterial } from './WaterColorTuning';
import { PERFORMANCE_CONFIG } from '../core/PerformanceConfig';

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
// Small tiling grayscale texture that fakes the row of round beads/discs of a real lane
// rope. It is multiplied by each rope's flat color on an unlit material, so we get the
// beaded, shaded Mario-style look without lighting (no blue ambient tint) and without
// the geometry cost of modelling every bead. The rope UVs already repeat this along the
// length, so the texture just needs REPEAT wrapping.
const LANE_FLOAT_BEAD_TEXTURE_PATH = 'pool/LaneFloatBeads/texture';
// The rope UVs already bake the bead count into U (6 beads per color segment, aligned to
// color edges), so no extra tiling scale is needed.
const LANE_FLOAT_BEAD_TILING = 1.0;

// Venue branding is applied at runtime by texture path so the art can be swapped just by
// replacing the PNG file (no GLB re-import). Each spec maps a venue node-name prefix to a
// swappable texture under the race bundle.
type BrandingSpec = { prefix: string; texturePath: string; repeat: boolean };
const BRANDING_SPECS: BrandingSpec[] = [
    { prefix: 'fascia_wall', texturePath: 'pool/PoolFasciaBrand/texture', repeat: true },
    { prefix: 'banner_', texturePath: 'pool/PoolBanner/texture', repeat: false },
];

export class WaterSurfaceBinder {
    bind(pool: Node, waterMaterialPath: string, debug?: (message: string) => void) {
        const oldWaterNodes: Node[] = [];
        collectNodesByName(pool, LEGACY_WATER_NODE_NAMES, oldWaterNodes);
        for (const node of oldWaterNodes) {
            node.active = false;
        }

        this.loadBeadTextureThenUnlitFloats(pool, debug);
        this.bindBranding(pool, debug);
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

    private loadBeadTextureThenUnlitFloats(pool: Node, debug?: (message: string) => void) {
        loadRaceAsset(LANE_FLOAT_BEAD_TEXTURE_PATH, Texture2D, (err, texture) => {
            if (!pool.isValid) {
                return;
            }
            if (err || !texture) {
                console.warn('[SpeedSwimming] lane float bead texture load failed; floats stay flat unlit', err);
                this.unlitLaneFloats(pool, null, debug);
                return;
            }
            texture.setWrapMode(Texture2D.WrapMode.REPEAT, Texture2D.WrapMode.REPEAT);
            this.unlitLaneFloats(pool, texture, debug);
        });
    }

    private bindBranding(pool: Node, debug?: (message: string) => void) {
        // When the jumbotron feed is ON it renders the live view onto the screens; when it
        // is OFF, fall back to a static scoreboard image so the screens aren't blank.
        const specs = PERFORMANCE_CONFIG.scoreboardFeed.enabled
            ? BRANDING_SPECS
            : [...BRANDING_SPECS, { prefix: 'scoreboard_screen', texturePath: 'pool/PoolScoreboard/texture', repeat: false }];
        for (const spec of specs) {
            loadRaceAsset(spec.texturePath, Texture2D, (err, texture) => {
                if (!pool.isValid) {
                    return;
                }
                if (err || !texture) {
                    console.warn(`[SpeedSwimming] branding texture load failed: ${spec.texturePath}`, err);
                    return;
                }
                const wrap = spec.repeat ? Texture2D.WrapMode.REPEAT : Texture2D.WrapMode.CLAMP_TO_EDGE;
                texture.setWrapMode(wrap, wrap);
                const nodes: Node[] = [];
                collectNodesByNamePrefix(pool, spec.prefix, nodes);
                let applied = 0;
                for (const node of nodes) {
                    const renderer = node.getComponent(MeshRenderer);
                    if (!renderer) {
                        continue;
                    }
                    const count = Math.max(1, renderer.sharedMaterials.length);
                    for (let i = 0; i < count; i++) {
                        renderer.setMaterial(makeUnlitBrandingMaterial(texture, node.name), i);
                    }
                    applied += 1;
                }
                if (applied > 0) {
                    debug?.(`branding applied prefix=${spec.prefix} nodes=${applied}`);
                }
            });
        }
    }

    private unlitLaneFloats(pool: Node, beadTexture: Texture2D | null, debug?: (message: string) => void) {
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
                renderer.setMaterial(makeUnlitLaneFloatMaterial(source, beadTexture), i);
            }
            boundRenderers += 1;
        }
        if (boundRenderers > 0) {
            debug?.(`lane floats set unlit renderers=${boundRenderers} beaded=${beadTexture ? 'yes' : 'no'}`);
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

// Apply a swappable branding texture on an unlit material so venue signage (fascia logos,
// scoreboards, hanging banners) shows at full color regardless of the dark stand lighting.
function makeUnlitBrandingMaterial(texture: Texture2D, nodeName: string): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } });
    material.name = `RuntimeBranding_${nodeName}`;
    material.setProperty('mainTexture', texture);
    material.setProperty('mainColor', new Color(255, 255, 255, 255));
    return material;
}

// Convert a lit GLB float material into an unlit one that keeps its albedo, so the blue
// ambient sky light no longer tints the lane floats.
function makeUnlitLaneFloatMaterial(source: Material, beadTexture: Texture2D | null): Material {
    const material = new Material();
    if (beadTexture) {
        material.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } });
        material.setProperty('mainTexture', beadTexture);
        // The rope UVs pack ~247 bead tiles along the length; scale U down so the beads
        // read as bigger, cleaner discs (~124 beads instead of a muddy fine stripe).
        material.setProperty('tilingOffset', new Vec4(LANE_FLOAT_BEAD_TILING, 1, 0, 0));
    } else {
        material.initialize({ effectName: 'builtin-unlit' });
    }
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
