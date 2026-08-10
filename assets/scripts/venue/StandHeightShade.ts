import { Color, EffectAsset, Mat4, Material, MeshRenderer, Node, Texture2D, Vec3, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

// "Arena dimming" pass: darken the grandstand / wall geometry by BOTH world
// height and horizontal distance from the pool, so the venue reads like the
// reference photo (bright poolside, fading dark toward the top and far corners).
// Pool/water/lane-floats/swimmers stay bright.
//
// Implementation: swap each stand renderer's material to VenueHeightShade.effect
// (an unlit shader that multiplies the visible colour by a per-PIXEL height/
// distance brightness gradient in the fragment shader). We do NOT read or rebuild
// meshes — that only works in the editor/web (mesh CPU data is released on device,
// so utils.readMesh returns nothing and the effect silently does nothing). The
// GPU gradient needs only the world position, so it works on WeChat/real devices.
// Only the mesh AABB (struct.min/maxPosition, metadata that survives on device)
// is read, to compute the global height/distance range.

// Node-name keywords that count as "stands / arena structure" (lowercased,
// matched as substrings so merged nodes like CornerStands_Merged /
// StandStructure_Merged are covered too).
const STAND_KEYWORDS = [
    'bleacher',
    'grandstand',
    'stand',
    'corner',
    'olympicpanel',
    'platform',
];

// Pool footprint in world space (cocos): X[0,50], Z[±half].
const POOL_MIN_X = 0;
const POOL_MAX_X = 50;
const POOL_HALF_Z = 10.5;

// Horizontal distance (m) near the pool kept fully bright (first-tier railing).
const NEAR_KEEP_M = 6;

// Source-material texture uniforms to carry over onto the shaded material.
const TEXTURE_KEYS = ['emissiveMap', 'albedoMap', 'mainTexture'];

// Keep walls, Access stairs and platforms white. Ordinary bleacher steps use a
// separate cyan-grey tint so they remain distinct from the dark-blue seats.
const WALL_TINT = new Color(255, 255, 255);
const BLEACHER_STEP_TINT = new Color(132, 196, 204);
const CONCRETE_MATERIAL_KEYWORD = 'bleacher_step_concrete';
const EMERGENCY_EXIT_MATERIAL_KEYWORD = 'emergencyexit';
const SOFFIT_MATERIAL_KEYWORD = 'upper_tier_soffit_dark';

const _mat = new Mat4();
const _corner = new Vec3();

export interface StandHeightShadeOptions {
    // Brightness multiplier at the poolside baseline.
    bottomBrightness?: number;
    // Brightness multiplier at the darkest point (top and/or far corners).
    topBrightness?: number;
    // Gamma on the 0..1 height factor (<1 = obvious already from the 2nd tier).
    heightCurve?: number;
    // Gamma on the 0..1 horizontal-distance factor.
    distanceCurve?: number;
    // Horizontal metres near the pool kept fully bright.
    nearKeep?: number;
}

function isStandNode(name: string): boolean {
    const lower = name.toLowerCase();
    return STAND_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isWallNode(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.includes('standstructure') || lower.includes('upperplatform');
}

function isBleacherModule(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.startsWith('bleacherbatch_') || lower === 'cornerstands_merged';
}

function isConcreteMaterial(material: Material | null): boolean {
    return material?.name.toLowerCase().includes(CONCRETE_MATERIAL_KEYWORD) ?? false;
}

function isEmergencyExitMaterial(material: Material | null): boolean {
    return material?.name.toLowerCase().includes(EMERGENCY_EXIT_MATERIAL_KEYWORD) ?? false;
}

function isSoffitMaterial(material: Material | null): boolean {
    return material?.name.toLowerCase().includes(SOFFIT_MATERIAL_KEYWORD) ?? false;
}

function horizontalPoolDistance(x: number, z: number): number {
    const dx = x < POOL_MIN_X ? POOL_MIN_X - x : x > POOL_MAX_X ? x - POOL_MAX_X : 0;
    const az = Math.abs(z);
    const dz = az > POOL_HALF_Z ? az - POOL_HALF_Z : 0;
    return Math.hypot(dx, dz);
}

function readVisibleColor(source: Material | null): Color {
    const emissive = source?.getProperty('emissive', 0);
    if (emissive instanceof Color) {
        return emissive.clone();
    }
    const main = source?.getProperty('mainColor', 0);
    if (main instanceof Color) {
        return main.clone();
    }
    return Color.WHITE.clone();
}

function findMaterialTexture(source: Material | null): Texture2D | null {
    if (!source) {
        return null;
    }
    for (const key of TEXTURE_KEYS) {
        const value = source.getProperty(key, 0);
        if (value instanceof Texture2D) {
            return value;
        }
    }
    return null;
}

// World-space height range + max horizontal pool distance from each renderer's
// AABB corners (mesh.struct metadata is available on device, unlike vertex data).
function accumulateBounds(
    renderer: MeshRenderer,
    range: { minY: number; maxY: number; maxDist: number },
): void {
    const mesh = renderer.mesh;
    const min = mesh?.struct.minPosition;
    const max = mesh?.struct.maxPosition;
    if (!min || !max) {
        return;
    }
    renderer.node.getWorldMatrix(_mat);
    for (let i = 0; i < 8; i++) {
        _corner.set(
            (i & 1) ? max.x : min.x,
            (i & 2) ? max.y : min.y,
            (i & 4) ? max.z : min.z,
        );
        Vec3.transformMat4(_corner, _corner, _mat);
        if (_corner.y < range.minY) {
            range.minY = _corner.y;
        }
        if (_corner.y > range.maxY) {
            range.maxY = _corner.y;
        }
        const dist = horizontalPoolDistance(_corner.x, _corner.z);
        if (dist > range.maxDist) {
            range.maxDist = dist;
        }
    }
}

function makeShadeMaterial(
    effect: EffectAsset,
    source: Material | null,
    tint: Color | null,
    poolRect: Vec4,
    heightRange: Vec4,
    shadeCurve: Vec4,
): Material {
    // A tinted wall ignores its greyish source texture/colour; other stands keep
    // their original colour (and texture, e.g. the Olympic logo panels).
    const texture = tint ? null : findMaterialTexture(source);
    const material = new Material();
    material.initialize({
        effectAsset: effect,
        defines: texture ? { USE_TEXTURE: true } : {},
    });
    material.name = 'RuntimeStandShade';
    material.setProperty('mainColor', tint ? tint.clone() : readVisibleColor(source));
    if (texture) {
        material.setProperty('mainTexture', texture);
    }
    material.setProperty('poolRect', poolRect);
    material.setProperty('heightRange', heightRange);
    material.setProperty('shadeCurve', shadeCurve);
    return material;
}

function shadeStands(
    pool: Node,
    effect: EffectAsset,
    options: StandHeightShadeOptions | undefined,
    debug: ((message: string) => void) | undefined,
): number {
    const bottom = options?.bottomBrightness ?? 0.55;
    const top = options?.topBrightness ?? 0.08;
    // Small gamma so the darkening kicks in hard from the 2nd tier up. Even the
    // poolside tier stays dim; the unlit pool remains the clear focal area.
    const heightCurve = options?.heightCurve ?? 0.28;
    const distanceCurve = options?.distanceCurve ?? 0.85;
    const nearKeep = options?.nearKeep ?? NEAR_KEEP_M;

    const renderers: MeshRenderer[] = [];
    const names: string[] = [];
    const walk = (node: Node) => {
        if (isStandNode(node.name)) {
            const renderer = node.getComponent(MeshRenderer);
            if (renderer && renderer.mesh) {
                renderers.push(renderer);
                names.push(node.name);
            }
        }
        for (const child of node.children) {
            walk(child);
        }
    };
    walk(pool);

    if (renderers.length <= 0) {
        debug?.('stand shade matched 0 renderers');
        return 0;
    }

    const range = { minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY, maxDist: 0 };
    for (const renderer of renderers) {
        accumulateBounds(renderer, range);
    }
    const minY = range.minY;
    const spanY = Math.max(0.0001, range.maxY - range.minY);
    const spanDist = Math.max(0.0001, range.maxDist - nearKeep);

    const poolRect = new Vec4(POOL_MIN_X, POOL_MAX_X, POOL_HALF_Z, nearKeep);
    const heightRange = new Vec4(minY, spanY, spanDist, 0);
    const shadeCurve = new Vec4(bottom, top, heightCurve, distanceCurve);

    // Share one material per (source colour + texture), or one per wall tint, so
    // same-coloured stands keep batching instead of each getting a unique
    // material instance (which would break the venue's static batching and add
    // ~20 draw calls). The shade uniforms are global, so sharing is safe.
    const materialCache = new Map<string, Material>();
    for (const renderer of renderers) {
        const slots = Math.max(1, renderer.sharedMaterials.length);
        for (let sub = 0; sub < slots; sub++) {
            const source = renderer.getSharedMaterial(sub);
            // Exit signs simulate powered lamps. The tier-3 underside also has
            // an authored dark ceiling colour so it stays distinct from white
            // walls and remains a stable base for future ceiling lights.
            if (isEmergencyExitMaterial(source) || isSoffitMaterial(source)) {
                continue;
            }
            const concrete = isConcreteMaterial(source);
            const bleacherStep = concrete && isBleacherModule(renderer.node.name);
            const tint = bleacherStep
                ? BLEACHER_STEP_TINT
                : isWallNode(renderer.node.name) || concrete ? WALL_TINT : null;
            const texture = tint ? null : findMaterialTexture(source);
            const key = tint
                ? bleacherStep ? 'bleacher-step' : 'wall'
                : `${readVisibleColor(source).toHEX('#rrggbb')}|${texture ? texture.uuid : 'n'}`;
            let material = materialCache.get(key);
            if (!material) {
                material = makeShadeMaterial(effect, source, tint, poolRect, heightRange, shadeCurve);
                materialCache.set(key, material);
            }
            renderer.setMaterial(material, sub);
        }
    }
    console.log(`[SpeedSwimming] stand shade: ${renderers.length} renderers -> ${materialCache.size} shared materials`);
    debug?.(`stand shade applied to ${renderers.length} renderers, ${materialCache.size} shared materials: ${names.join(', ')}`);
    return renderers.length;
}

// Darken the stands by height + horizontal distance from the pool. Loads the
// VenueHeightShade effect from the race bundle, then swaps stand materials.
export function applyStandHeightShade(
    pool: Node | null,
    options?: StandHeightShadeOptions,
    debug?: (message: string) => void,
): void {
    if (!pool?.isValid) {
        return;
    }
    loadRaceAsset(RESOURCE_PATHS.venueHeightShadeEffect, EffectAsset, (error, effect) => {
        if (error || !effect) {
            console.warn('[SpeedSwimming] venue height shade effect load failed', error);
            debug?.('stand shade skipped: effect load failed');
            return;
        }
        if (!pool.isValid) {
            return;
        }
        try {
            shadeStands(pool, effect, options, debug);
        } catch (shadeError) {
            console.warn('[SpeedSwimming] stand height shade skipped', shadeError);
        }
    });
}
