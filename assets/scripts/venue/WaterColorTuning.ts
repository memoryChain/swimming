import { Color, Material, Vec4 } from 'cc';
import { PERFORMANCE_CONFIG } from '../core/PerformanceConfig';

// Runtime-tunable water/underwater colours. The debug tuning panel writes these
// fields (see TuningDebugControls '水色' group) and calls applyWaterColorTuning()
// so the look updates live without editing .mtl/.effect files or rebuilding.
//
// Colour channels are sRGB bytes (0-255) to match how the material stores them.
// The defaults mirror the shipped RagingPoolWater.mtl / SwimmerDynamicColor.effect
// values, so registering a material before any tuning change is a no-op.
export const WATER_COLOR_TUNING = {
    // Pool water surface (RagingPoolWater): deep = base tone, shallow = highlight.
    deepR: 46, deepG: 156, deepB: 232,
    shallowR: 128, shallowG: 212, shallowB: 250,
    // refractionParams.z: how strongly the flat water colour tints the refracted
    // floor (0 = clear floor, 1 = solid water colour).
    tintStrength: 0.5,
    // Explicit flat water surface colour that overrides the refraction detail.
    // surfaceStrength = how strongly this exact colour wins (0 = pure refraction
    // look, 1 = solid obvious colour). This is the direct "just set the water
    // colour" knob. Default = the bright azure pool blue from Mario & Sonic 2020.
    surfaceR: 16, surfaceG: 112, surfaceB: 206,
    surfaceStrength: 0.32,
    // Swimmer submerged-body blue (SwimmerDynamicColor waterLine tint) + strength.
    bodyR: 40, bodyG: 150, bodyB: 226,
    bodyStrength: 0.8,
};

const _waterMaterials: Material[] = [];
const _swimmerMaterials: Material[] = [];

// Register the live pool-water material so tuning changes reach it. Applies the
// current tuning immediately.
export function registerWaterMaterial(material: Material | null | undefined) {
    if (!material || _waterMaterials.indexOf(material) >= 0) {
        return;
    }
    _waterMaterials.push(material);
    applyWaterMaterial(material);
}

// Register a swimmer body material (the SwimmerDynamicColor effect instance) so
// underwater tint changes reach it. Applies the current tuning immediately.
export function registerSwimmerBodyMaterial(material: Material | null | undefined) {
    if (!material || _swimmerMaterials.indexOf(material) >= 0) {
        return;
    }
    _swimmerMaterials.push(material);
    applySwimmerMaterial(material);
}

// Push the current WATER_COLOR_TUNING values onto every registered material.
export function applyWaterColorTuning() {
    for (const material of _waterMaterials) {
        applyWaterMaterial(material);
    }
    for (const material of _swimmerMaterials) {
        applySwimmerMaterial(material);
    }
}

function applyWaterMaterial(material: Material) {
    try {
        material.setProperty('deepColor', new Color(WATER_COLOR_TUNING.deepR, WATER_COLOR_TUNING.deepG, WATER_COLOR_TUNING.deepB, 255));
        material.setProperty('shallowColor', new Color(WATER_COLOR_TUNING.shallowR, WATER_COLOR_TUNING.shallowG, WATER_COLOR_TUNING.shallowB, 255));
        // Preserve refractionParams x (distort) / y (flipY) / w (frequency); only
        // retune z (tint strength).
        const current = material.getProperty('refractionParams') as Vec4 | null;
        const x = current?.x ?? 0.006;
        const y = current?.y ?? 0;
        const w = current?.w ?? 5.5;
        material.setProperty('refractionParams', new Vec4(x, y, WATER_COLOR_TUNING.tintStrength, w));
        // Explicit flat surface colour: rgb = colour, a = override strength.
        material.setProperty('waterColor', new Color(
            WATER_COLOR_TUNING.surfaceR,
            WATER_COLOR_TUNING.surfaceG,
            WATER_COLOR_TUNING.surfaceB,
            Math.max(0, Math.min(255, Math.round(WATER_COLOR_TUNING.surfaceStrength * 255))),
        ));
        material.setProperty('roofReflectionParams', new Vec4(
            6.2,
            5.0,
            0.42,
            PERFORMANCE_CONFIG.water.roofLightReflectionEnabled
                ? PERFORMANCE_CONFIG.water.roofLightReflectionStrength
                : 0,
        ));
        // Keep the animated caustic light blobs OFF. The shipped shader has the
        // caustic code removed, but the editor preview may still run a stale build
        // that includes it, so force causticParams.w = 0 here too (uniform, applies
        // without an effect recompile) to avoid the drifting white smudges.
        const caustic = material.getProperty('causticParams') as Vec4 | null;
        if (caustic) {
            material.setProperty('causticParams', new Vec4(caustic.x, caustic.y, caustic.z, 0));
        }
    } catch {
        // Material's effect lacks these uniforms; ignore.
    }
}

function applySwimmerMaterial(material: Material) {
    try {
        material.setProperty('underwaterColor', new Color(
            WATER_COLOR_TUNING.bodyR,
            WATER_COLOR_TUNING.bodyG,
            WATER_COLOR_TUNING.bodyB,
            Math.max(0, Math.min(255, Math.round(WATER_COLOR_TUNING.bodyStrength * 255))),
        ));
    } catch {
        // Not a swimmer body material; ignore.
    }
}
