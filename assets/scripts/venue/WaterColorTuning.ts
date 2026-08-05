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
    // Above-waterline haze: a body part poking out of the surface, seen from an
    // UNDERWATER camera, fades toward this pale washed colour (reads as poking
    // through the surface, not a hard glitch). Only when the camera is submerged.
    aboveR: 150, aboveG: 195, aboveB: 225,
    aboveStrength: 0.75,
    // Distance-based blue absorption for submerged bodies: far swimmers read
    // bluer than near ones. depthColor = deep-water blue, depthStrength = max
    // blend, depthStart/depthEnd = camera distances (m) over which blue ramps in.
    depthR: 26, depthG: 120, depthB: 200,
    depthStrength: 0.55,
    depthStart: 4.0,
    depthEnd: 24.0,
    // Underwater pool-floor blue (the colour the floor/walls swap to when the
    // camera is below the surface). Walls/grout are derived shades of this.
    // Tuned to match the bright, slightly-cyan light blue seen when looking DOWN
    // at the pool from above the surface (green kept close to blue = cyan-ish).
    floorR: 142, floorG: 200, floorB: 222,
    // Underwater distance gradient: near the camera the floor keeps its (brighter)
    // floor blue; farther away it fades toward a deep blue derived from floorR/G/B.
    // Strength = how deep the far end gets (0 = uniform, off), start/end = camera
    // distances (m) over which it ramps in (underwater camera is close, ~5m).
    floorFarStrength: 0.85,
    floorFarStart: 3.0,
    floorFarEnd: 20.0,
    // How strongly the underwater surface mirror is tinted toward deepColor
    // (0 = raw reflection / whiter, 1 = fully deep-water blue).
    reflectionBlue: 0.45,
};

// The pool-floor underwater colour lives in WaterRefractionController (it owns
// the runtime floor materials + the above/below camera swap). It registers an
// applier so the '水色' floor sliders can re-tint the submerged floor live.
let _floorTintApply: (() => void) | null = null;
export function registerFloorTintApplier(fn: () => void) {
    _floorTintApply = fn;
    fn();
}

const _waterMaterials: Material[] = [];
const _swimmerMaterials: Material[] = [];
// Whether swimmer draws should clip their above-water fragments (set only while
// the underwater mirror-reflection camera is rendering; see setSwimmerReflectClip).
let _swimmerReflectClip = false;

// Toggle the reflection clip flag on every registered swimmer material. Called by
// WaterRefractionController when the main camera crosses below the surface, so the
// reflection pass drops above-water fragments (no ghost) while direct/broadcast
// draws stay intact. No-op when unchanged (avoids per-frame material writes).
export function setSwimmerReflectClip(on: boolean) {
    if (on === _swimmerReflectClip) {
        return;
    }
    _swimmerReflectClip = on;
    for (const material of _swimmerMaterials) {
        applySwimmerReflectClip(material);
    }
}

function applySwimmerReflectClip(material: Material) {
    try {
        material.setProperty('reflectClipParams', new Vec4(_swimmerReflectClip ? 1 : 0, 0, 0, 0));
    } catch {
        // Material's effect lacks the uniform; ignore.
    }
}

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
    _floorTintApply?.();
}

function applyWaterMaterial(material: Material) {
    try {
        material.setProperty('deepColor', new Color(WATER_COLOR_TUNING.deepR, WATER_COLOR_TUNING.deepG, WATER_COLOR_TUNING.deepB, 255));
        material.setProperty('shallowColor', new Color(WATER_COLOR_TUNING.shallowR, WATER_COLOR_TUNING.shallowG, WATER_COLOR_TUNING.shallowB, 255));
        // Reflection blue tint strength (underwater surface mirror).
        material.setProperty('reflectionTint', new Vec4(WATER_COLOR_TUNING.reflectionBlue, 0, 0, 0));
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
        material.setProperty('depthFogColor', new Color(
            WATER_COLOR_TUNING.depthR,
            WATER_COLOR_TUNING.depthG,
            WATER_COLOR_TUNING.depthB,
            Math.max(0, Math.min(255, Math.round(WATER_COLOR_TUNING.depthStrength * 255))),
        ));
        material.setProperty('depthFogParams', new Vec4(
            WATER_COLOR_TUNING.depthStart,
            WATER_COLOR_TUNING.depthEnd,
            1,
            0,
        ));
        material.setProperty('aboveWaterColor', new Color(
            WATER_COLOR_TUNING.aboveR,
            WATER_COLOR_TUNING.aboveG,
            WATER_COLOR_TUNING.aboveB,
            Math.max(0, Math.min(255, Math.round(WATER_COLOR_TUNING.aboveStrength * 255))),
        ));
        material.setProperty('reflectClipParams', new Vec4(_swimmerReflectClip ? 1 : 0, 0, 0, 0));
    } catch {
        // Not a swimmer body material; ignore.
    }
}
