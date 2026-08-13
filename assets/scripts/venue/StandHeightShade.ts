import { Color, EffectAsset, Material, MeshRenderer, Node, Texture2D } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

// "Arena dimming": the stands / walls / structure get darker with height and
// distance from the pool. That gradient is BAKED into per-vertex colours
// (COLOR_0) by the venue export script (sceneresource/export-flatcolor-venue-glb.py)
// — a fixed scene with fixed lighting, so there is NO runtime height/distance
// computation. This pass only swaps each stand renderer onto the unlit
// VenueHeightShade material (mainColor/texture × baked vertex colour). The
// bleacher atlas keeps white vertex colours, so its authored T1-T4 tiers are
// unchanged. Emergency-exit "lamps" and the dark tier soffit keep their source
// materials so they are not dimmed.

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

// Source-material texture uniforms to carry over onto the shaded material.
const TEXTURE_KEYS = ['emissiveMap', 'albedoMap', 'mainTexture'];

// Exit "lamps" and the dark tier soffit keep their source materials (no dimming).
const EMERGENCY_EXIT_MATERIAL_KEYWORD = 'emergencyexit';
const SOFFIT_MATERIAL_KEYWORD = 'upper_tier_soffit_dark';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface StandHeightShadeOptions {
    // Reserved: the dimming curve is baked into vertex colours, not runtime.
}

function isStandNode(name: string): boolean {
    const lower = name.toLowerCase();
    return STAND_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isEmergencyExitMaterial(material: Material | null): boolean {
    return material?.name.toLowerCase().includes(EMERGENCY_EXIT_MATERIAL_KEYWORD) ?? false;
}

function isSoffitMaterial(material: Material | null): boolean {
    return material?.name.toLowerCase().includes(SOFFIT_MATERIAL_KEYWORD) ?? false;
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

function makeShadeMaterial(effect: EffectAsset, source: Material | null): Material {
    // Keep the source colour + texture (e.g. the Olympic logo panels, the
    // bleacher atlas). The baked vertex colour supplies the dimming.
    const texture = findMaterialTexture(source);
    const material = new Material();
    material.initialize({
        effectAsset: effect,
        defines: texture ? { USE_TEXTURE: true } : {},
    });
    material.name = 'RuntimeStandShade';
    material.setProperty('mainColor', readVisibleColor(source));
    if (texture) {
        material.setProperty('mainTexture', texture);
    }
    return material;
}

function shadeStands(
    pool: Node,
    effect: EffectAsset,
    debug: ((message: string) => void) | undefined,
): number {
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

    // Share one material per (source colour + texture) so same-looking stands keep
    // static batching instead of each getting a unique material instance (which
    // would break the venue's static batching and add ~20 draw calls).
    const materialCache = new Map<string, Material>();
    for (const renderer of renderers) {
        const slots = Math.max(1, renderer.sharedMaterials.length);
        for (let sub = 0; sub < slots; sub++) {
            const source = renderer.getSharedMaterial(sub);
            // Exit signs simulate powered lamps; the tier soffit keeps its
            // authored dark ceiling colour. Both stay on their source materials.
            if (isEmergencyExitMaterial(source) || isSoffitMaterial(source)) {
                continue;
            }
            const texture = findMaterialTexture(source);
            const key = `${readVisibleColor(source).toHEX('#rrggbb')}|${texture ? texture.uuid : 'n'}`;
            let material = materialCache.get(key);
            if (!material) {
                material = makeShadeMaterial(effect, source);
                materialCache.set(key, material);
            }
            renderer.setMaterial(material, sub);
        }
    }
    console.log(`[SpeedSwimming] stand shade: ${renderers.length} renderers -> ${materialCache.size} shared materials`);
    debug?.(`stand shade applied to ${renderers.length} renderers, ${materialCache.size} shared materials: ${names.join(', ')}`);
    return renderers.length;
}

// Swap the stands onto the unlit VenueHeightShade material so their baked
// per-vertex dimming shows. Loads the effect from the race bundle first.
export function applyStandHeightShade(
    pool: Node | null,
    _options?: StandHeightShadeOptions,
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
            shadeStands(pool, effect, debug);
        } catch (shadeError) {
            console.warn('[SpeedSwimming] stand height shade skipped', shadeError);
        }
    });
}
