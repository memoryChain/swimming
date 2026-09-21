import { Color, Material, Node, Vec3, Vec4 } from 'cc';
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
    // Swimmer colour transmission while an ABOVE-WATER camera looks through the
    // surface. The shader treats rgb as a normalized spectral filter rather than
    // a replacement colour, so black suits stay dark and skin retains some warmth.
    bodyR: 54, bodyG: 144, bodyB: 205,
    bodyStrength: 0.30,
    // The same transmission seen by a SUBMERGED camera. Near underwater footage
    // is white-balanced and preserves much more local skin/suit colour than a view
    // through the surface, so this filter is gentler and less saturated.
    underBodyR: 104, underBodyG: 172, underBodyB: 206,
    underBodyStrength: 0.24,
    // Soft top-light range for submerged fragments. Replaces the old 0.3x..1.8x
    // direct-light multiplier that blew upper surfaces out to grey-white.
    underLightMin: 0.34,
    underLightMax: 1.06,
    surfaceLightMin: 0.56,
    surfaceLightMax: 0.96,
    // Luminance-preserving blue fill applied mainly to the body's dark regions.
    // The above-water view gets a little more so its strongly darkened submerged
    // torso reads as being in water rather than as plain brown shadow.
    underShadowBlue: 0.10,
    surfaceShadowBlue: 0.14,
    // Above-waterline haze: a body part poking out of the surface, seen from an
    // UNDERWATER camera, fades toward this pale washed colour (reads as poking
    // through the surface, not a hard glitch). Only when the camera is submerged.
    aboveR: 105, aboveG: 172, aboveB: 205,
    aboveStrength: 0.45,
    // Distance-based blue absorption for submerged bodies: far swimmers read
    // bluer than near ones. depthColor = deep-water blue, depthStrength = max
    // blend, depthStart/depthEnd = camera distances (m) over which blue ramps in.
    // Aligned to the same saturated azure as the underwater floor (a deeper shade
    // of floorR/G/B) so bodies and floor read as one coherent blue.
    depthR: 38, depthG: 111, depthB: 175,
    depthStrength: 0.45,
    depthStart: 6.0,
    depthEnd: 24.0,
    // Underwater pool-floor NEAR colour. A bright, low-saturation pool cyan matches
    // the close tiles in the real reference without the previous green cast.
    // Walls/grout are derived shades of this near colour.
    floorR: 136, floorG: 181, floorB: 204,
    // Independent FAR colour. Keeping this separate from the near colour allows
    // a real hue shift (pale pool cyan -> deep blue), not just a darker version
    // of the same tint. Alpha/strength controls how fully distant texture detail
    // is absorbed into this water colour.
    floorFarR: 8, floorFarG: 84, floorFarB: 146,
    floorFarStrength: 1.0,
    // Start at the camera rather than after a flat near plateau. The 18m value is
    // an asymptotic absorption scale, not a hard endpoint, so the large planar
    // floor never exposes a visible equal-distance colour boundary.
    floorFarStart: 0.0,
    floorFarEnd: 18.0,
    // How strongly the underwater surface mirror is tinted toward deepColor
    // (0 = raw reflection / whiter, 1 = fully deep-water blue). Nudged up so the
    // underside-of-surface mirror reads the same azure as the floor/bodies.
    reflectionBlue: 0.5,
    // Underwater reflection-surface distance brightness: near the camera the
    // mirror stays bright; from reflectionNear..reflectionFar (metres) it fades
    // toward the deep blue by reflectionFarStrength (0 = uniform, 1 = fully deep).
    // Matches how the real underside-of-surface is brighter close to the lens.
    reflectionNear: 2.0,
    reflectionFar: 10.0,
    reflectionFarStrength: 0.9,
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
const _swimmerMaterialOwners = new Map<Material, Node>();
// 每个身体材质对应一个渲染槽位；实例由渲染器持有，只缓存更新目标。
const _swimmerMaterialInstances = new Map<Material, Material>();
const _drySwimmerMaterials = new Set<Material>();
// Identify the one mirrored camera that is allowed to clip above-water swimmer
// fragments. Auxiliary above-water cameras (event PIP, venue feed, previews) use
// the same materials, so a shared boolean would incorrectly clip all of them.
const _swimmerReflectClipParams = new Vec4(0, 0, 0, 0);
const _disabledReflectClipParams = new Vec4(0, 0, 0, 0);
const REFLECTION_CAMERA_POSITION_STEPS_PER_METRE = 20;

// 只在反射相机采样帧调用；位置量化用于区分相机，不承担更新限频。
// 换肤、换模型和离场主动注销，无水预览不参与反射参数更新。
export function setSwimmerReflectClip(on: boolean, cameraPosition?: Readonly<Vec3>) {
    const enabled = on && !!cameraPosition;
    const x = enabled ? quantizeReflectionPosition(cameraPosition.x) : 0;
    const y = enabled ? quantizeReflectionPosition(cameraPosition.y) : 0;
    const z = enabled ? quantizeReflectionPosition(cameraPosition.z) : 0;
    if (_swimmerReflectClipParams.x === (enabled ? 1 : 0)
        && _swimmerReflectClipParams.y === x
        && _swimmerReflectClipParams.z === y
        && _swimmerReflectClipParams.w === z) {
        return;
    }
    _swimmerReflectClipParams.set(enabled ? 1 : 0, x, y, z);
    for (let index = _swimmerMaterials.length - 1; index >= 0; index--) {
        const material = _swimmerMaterials[index];
        const owner = _swimmerMaterialOwners.get(material);
        if (!material.isValid || (owner && !owner.isValid)) {
            unregisterSwimmerBodyMaterial(material);
            if (material.isValid) material.destroy();
            continue;
        }
        if (_drySwimmerMaterials.has(material)) continue;
        applySwimmerReflectClip(swimmerRenderMaterial(material));
    }
}

function applySwimmerReflectClip(material: Material) {
    try {
        material.setProperty('reflectClipParams', _swimmerReflectClipParams);
    } catch {
        // Material's effect lacks the uniform; ignore.
    }
}

function quantizeReflectionPosition(value: number): number {
    return Math.round(value * REFLECTION_CAMERA_POSITION_STEPS_PER_METRE)
        / REFLECTION_CAMERA_POSITION_STEPS_PER_METRE;
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
export function registerSwimmerBodyMaterial(material: Material | null | undefined, owner?: Node, reflect = true) {
    if (!material || _swimmerMaterials.indexOf(material) >= 0) {
        return;
    }
    _swimmerMaterials.push(material);
    if (owner) _swimmerMaterialOwners.set(material, owner);
    if (!reflect) _drySwimmerMaterials.add(material);
    applySwimmerMaterial(material, reflect);
}

/** 发光首次取得实例时绑定；镜头静止也立即补齐当前水色和裁切参数。 */
export function bindSwimmerBodyMaterialInstance(shared: Material, instance: Material): void {
    if (!shared.isValid || !instance.isValid || _swimmerMaterials.indexOf(shared) < 0) return;
    if (_swimmerMaterialInstances.get(shared) === instance) return;
    _swimmerMaterialInstances.set(shared, instance);
    applySwimmerMaterial(instance, !_drySwimmerMaterials.has(shared));
}

function swimmerRenderMaterial(shared: Material): Material {
    const instance = _swimmerMaterialInstances.get(shared);
    // Cocos 的实例销毁直接清空 passes，isValid 仍可能为 true。
    if (instance?.isValid && instance.passes.length > 0) return instance;
    if (instance) _swimmerMaterialInstances.delete(shared);
    return shared;
}

function unregisterSwimmerBodyMaterial(material: Material): void {
    const index = _swimmerMaterials.indexOf(material);
    if (index >= 0) _swimmerMaterials.splice(index, 1);
    _swimmerMaterialOwners.delete(material);
    _swimmerMaterialInstances.delete(material);
    _drySwimmerMaterials.delete(material);
}

/** 换肤先退出登记，旧材质仍供新材质读取纹理，替换完成后再销毁。 */
export function detachSwimmerBodyMaterials(owner: Node): Material[] {
    const detached: Material[] = [];
    for (let index = _swimmerMaterials.length - 1; index >= 0; index--) {
        const material = _swimmerMaterials[index];
        if (_swimmerMaterialOwners.get(material) !== owner) continue;
        detached.push(material);
        unregisterSwimmerBodyMaterial(material);
    }
    return detached;
}

export function disposeSwimmerBodyMaterials(owner: Node | null): void {
    if (!owner) return;
    for (const material of detachSwimmerBodyMaterials(owner)) {
        if (material.isValid) material.destroy();
    }
}

// Push the current WATER_COLOR_TUNING values onto every registered material.
export function applyWaterColorTuning() {
    for (const material of _waterMaterials) {
        applyWaterMaterial(material);
    }
    for (const material of _swimmerMaterials) {
        const reflect = !_drySwimmerMaterials.has(material);
        applySwimmerMaterial(material, reflect);
        const renderMaterial = swimmerRenderMaterial(material);
        if (renderMaterial !== material) applySwimmerMaterial(renderMaterial, reflect);
    }
    _floorTintApply?.();
}

function applyWaterMaterial(material: Material) {
    try {
        material.setProperty('deepColor', new Color(WATER_COLOR_TUNING.deepR, WATER_COLOR_TUNING.deepG, WATER_COLOR_TUNING.deepB, 255));
        material.setProperty('shallowColor', new Color(WATER_COLOR_TUNING.shallowR, WATER_COLOR_TUNING.shallowG, WATER_COLOR_TUNING.shallowB, 255));
        // Reflection blue tint strength (x) + underwater distance brightness
        // (y=near m, z=far m, w=far-fade strength) for the underside mirror.
        material.setProperty('reflectionTint', new Vec4(
            WATER_COLOR_TUNING.reflectionBlue,
            WATER_COLOR_TUNING.reflectionNear,
            WATER_COLOR_TUNING.reflectionFar,
            WATER_COLOR_TUNING.reflectionFarStrength,
        ));
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

function applySwimmerMaterial(material: Material, reflect: boolean) {
    try {
        material.setProperty('underwaterColor', new Color(
            WATER_COLOR_TUNING.bodyR,
            WATER_COLOR_TUNING.bodyG,
            WATER_COLOR_TUNING.bodyB,
            Math.max(0, Math.min(255, Math.round(WATER_COLOR_TUNING.bodyStrength * 255))),
        ));
        material.setProperty('underwaterViewColor', new Color(
            WATER_COLOR_TUNING.underBodyR,
            WATER_COLOR_TUNING.underBodyG,
            WATER_COLOR_TUNING.underBodyB,
            Math.max(0, Math.min(255, Math.round(WATER_COLOR_TUNING.underBodyStrength * 255))),
        ));
        material.setProperty('underwaterLightParams', new Vec4(
            WATER_COLOR_TUNING.underLightMin,
            WATER_COLOR_TUNING.underLightMax,
            WATER_COLOR_TUNING.surfaceLightMin,
            WATER_COLOR_TUNING.surfaceLightMax,
        ));
        material.setProperty('underwaterShadowParams', new Vec4(
            WATER_COLOR_TUNING.underShadowBlue,
            WATER_COLOR_TUNING.surfaceShadowBlue,
            0,
            0,
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
        material.setProperty('reflectClipParams', reflect ? _swimmerReflectClipParams : _disabledReflectClipParams);
    } catch {
        // Not a swimmer body material; ignore.
    }
}
