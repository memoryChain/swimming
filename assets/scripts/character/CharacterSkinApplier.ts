import { Color, EffectAsset, Material, MeshRenderer, Node, Quat, SkinnedMeshRenderer, Texture2D, Vec3, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { registerSwimmerBodyMaterial } from '../venue/WaterColorTuning';

const SWIMMER_TEXTURE_SIZE = 128;
const OUTLINE_SHELL_WIDTH = 10;

export type CharacterSkinOutfit = 'default' | 'trunksA';

export type CharacterSkinOptions = {
    root: Node;
    model: Node;
    skinnedRenderers: SkinnedMeshRenderer[];
    skinColor: Color;
    suitColor: Color;
    capColor: Color;
    robotStyle: boolean;
    playerOutline: boolean;
    outfit?: CharacterSkinOutfit;
    preserveOriginalMaterial?: boolean;
    dynamicColorEffect?: EffectAsset | null;
    colorMask?: Texture2D | null;
    dynamicColorMode?: 'mask' | 'whiteKey';
    // Water surface world Y. When provided together with dynamicColorEffect, the
    // swimmer body materials tint fragments below this height toward underwater
    // blue (see SwimmerDynamicColor.effect waterLine).
    waterLine?: number;
    outlineWidth?: number;
    outlineRoot: Node | null;
    setOutlineRoot: (root: Node | null) => void;
};

export function applyCharacterSkin(options: CharacterSkinOptions) {
    if (options.preserveOriginalMaterial) {
        applyBrightenedOriginalMaterials(options);
        configureOutlineShells(options);
        return;
    }

    if (applyLowSwimmerTextureMaterial(options)) {
        configureOutlineShells(options);
        return;
    }

    const { root, skinnedRenderers, skinColor, suitColor, capColor, robotStyle, playerOutline } = options;
    const skin = makeMaterial('GLBSwimmerSkin', skinColor, robotStyle ? 0.34 : 0.52, robotStyle ? 0.5 : 0);
    const suit = makeMaterial('GLBSwimmerSuit', suitColor, robotStyle ? 0.38 : 0.5, robotStyle ? 0.35 : 0.02);
    const cap = makeMaterial('GLBSwimmerCap', capColor, robotStyle ? 0.32 : 0.44, robotStyle ? 0.45 : 0.04);
    const white = makeMaterial('GLBSwimmerWhite', robotStyle ? new Color(175, 245, 255, 255) : new Color(242, 252, 255, 255), 0.22, 0.08);
    const dark = makeMaterial('GLBSwimmerDark', robotStyle ? new Color(20, 55, 70, 255) : new Color(10, 16, 24, 255), 0.4, robotStyle ? 0.35 : 0);

    const skinMatches = applyMaterialByName(root, [
        'Body', 'BodyMesh', 'Skin', 'Head', 'Neck', 'Face',
        'Arm', 'ForeArm', 'Hand', 'Leg', 'Foot', 'Toe',
        'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
        'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
    ], skin);
    const suitMatches = applyMaterialByName(root, [
        'Suit', 'Swimsuit', 'SwimSuit', 'Trunks', 'Shorts', 'Cloth', 'TorsoMesh', 'ChestMesh',
    ], suit);
    applyMaterialByName(root, ['SimpleSwimCap', 'Cap', 'SwimCap'], cap);
    applyMaterialByName(root, ['SimpleGoggleBand', 'GoggleBand'], dark);
    applyMaterialByName(root, ['LeftGoggleLens', 'RightGoggleLens', 'GoggleLens'], white);

    if (skinMatches + suitMatches === 0) {
        const fallback = robotStyle ? makeMaterial('GLBSwimmerLaneColor', blendColor(suitColor, capColor, 0.22), 0.32, 0.18) : skin;
        for (const renderer of skinnedRenderers) {
            renderer.setMaterial(fallback, 0);
        }
        console.log(`[SpeedSwimming] applied fallback athlete material robot=${robotStyle} outline=${playerOutline} renderers=${skinnedRenderers.length}`);
    }

    configureOutlineShells(options);
}

function applyBrightenedOriginalMaterials(options: CharacterSkinOptions) {
    let applied = 0;
    for (const renderer of options.skinnedRenderers) {
        for (let i = 0; i < 8; i++) {
            const original = renderer.getSharedMaterial(i);
            if (!original) {
                continue;
            }
            const material = options.dynamicColorEffect
                && (options.colorMask || options.dynamicColorMode === 'whiteKey')
                ? makeDynamicColorMaterial(
                    original,
                    options.dynamicColorEffect,
                    options.colorMask ?? null,
                    options.dynamicColorMode ?? 'mask',
                    options.skinColor,
                    options.suitColor,
                    options.capColor,
                    options.waterLine,
                )
                : makeBrightenedOriginalMaterial(original, options.dynamicColorEffect ?? null, options.waterLine);
            renderer.setMaterial(material, i);
            applied++;
        }
    }
    if (applied <= 0) {
        for (const renderer of options.skinnedRenderers) {
            renderer.setMaterial(makeUnlitMaterial('BrightOriginalFallback', new Color(255, 255, 255, 255)), 0);
        }
    }
}

function makeDynamicColorMaterial(
    original: Material,
    effect: EffectAsset,
    colorMask: Texture2D | null,
    colorMode: 'mask' | 'whiteKey',
    skinColor: Color,
    suitColor: Color,
    capColor: Color,
    waterLine?: number,
): Material {
    const texture = findMaterialTexture(original);
    if (!texture) {
        return makeBrightenedOriginalMaterial(original, effect, waterLine);
    }
    const material = new Material();
    material.initialize({ effectAsset: effect });
    material.name = 'SwimmerDynamicColor';
    material.setProperty('mainTexture', texture);
    if (colorMask) {
        material.setProperty('colorMask', colorMask);
    }
    material.setProperty('recolorParams', new Vec4(colorMode === 'whiteKey' ? 1 : 0, 0, 0, 0));
    material.setProperty('mainColor', new Color(255, 255, 255, 255));
    material.setProperty('skinColor', skinColor);
    material.setProperty('suitColor', suitColor);
    material.setProperty('capColor', capColor);
    applyWaterLine(material, waterLine);
    registerSwimmerBodyMaterial(material);
    return material;
}

// Feed the swimmer body effect's world-space waterline: x = water surface Y,
// y = fade depth. Skipped silently for materials whose effect lacks the uniform
// (e.g. the builtin-unlit fallback).
function applyWaterLine(material: Material, waterLine?: number) {
    try {
        // The custom swimmer effect has a serialized default waterline. Merely
        // omitting this uniform therefore still leaves a visible underwater
        // band in dry presentation scenes. Put the line far below the world
        // whenever no pool surface is supplied.
        material.setProperty('waterLine', new Vec4(
            typeof waterLine === 'number' ? waterLine : -10000,
            0.04,
            0.02,
            0.45,
        ));
    } catch {
        // Effect has no waterLine uniform; nothing to tint.
    }
}

function makeBrightenedOriginalMaterial(original: Material, waterlineEffect: EffectAsset | null = null, waterLine?: number): Material {
    const texture = findMaterialTexture(original);
    const color = boostColor(findMaterialColor(original), 1.12, 1.14);
    // Prefer the custom swimmer body effect (with the world-space waterline tint)
    // whenever it is loaded and the material has an albedo texture. A black
    // colorMask (the effect default) means no garment recolour, so it just shows
    // the original baked texture, plus the submerged-body blue below the surface.
    if (waterlineEffect && texture) {
        const material = new Material();
        material.initialize({ effectAsset: waterlineEffect });
        material.name = `${original.name || 'Original'}WaterlineUnlit`;
        material.setProperty('mainTexture', texture);
        material.setProperty('mainColor', color);
        applyWaterLine(material, waterLine);
        registerSwimmerBodyMaterial(material);
        return material;
    }
    const material = new Material();
    material.initialize(texture
        ? { effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } }
        : { effectName: 'builtin-unlit' });
    material.name = `${original.name || 'Original'}BrightUnlit`;
    material.setProperty('mainColor', color);
    if (texture) {
        material.setProperty('mainTexture', texture);
    }
    return material;
}

function applyLowSwimmerTextureMaterial(options: CharacterSkinOptions): boolean {
    const { skinnedRenderers, skinColor, suitColor, capColor, robotStyle, playerOutline, outfit = 'default' } = options;
    if (skinnedRenderers.length !== 1) {
        return false;
    }

    const renderer = skinnedRenderers[0];
    const looksLikeLowProxy = renderer.node.name === 'Skin' || renderer.node.name === 'node_0.003';
    if (!looksLikeLowProxy) {
        return false;
    }

    const tintSuit = suitColor;
    const tintCap = robotStyle ? blendColor(capColor, new Color(175, 245, 255, 255), 0.18) : capColor;
    renderer.setMaterial(makeSwimmerTextureMaterial(skinColor, tintSuit, tintCap, robotStyle, outfit), 0);
    console.log(`[SpeedSwimming] applied low swimmer texture material outfit=${outfit} suit=${tintSuit.r},${tintSuit.g},${tintSuit.b} cap=${tintCap.r},${tintCap.g},${tintCap.b} outline=${playerOutline}`);
    return true;
}

function findMaterialTexture(material: Material): Texture2D | null {
    const textureNames = ['albedoMap', 'mainTexture', 'baseColorMap', 'baseColorTexture'];
    for (const name of textureNames) {
        const value = getMaterialProperty(material, name);
        if (value instanceof Texture2D) {
            return value;
        }
    }
    return null;
}

function findMaterialColor(material: Material): Color {
    const colorNames = ['albedo', 'mainColor', 'baseColor'];
    for (const name of colorNames) {
        const value = getMaterialProperty(material, name);
        if (value instanceof Color) {
            return value;
        }
    }
    return new Color(255, 255, 255, 255);
}

function getMaterialProperty(material: Material, name: string): unknown {
    try {
        return material.getProperty(name);
    } catch {
        return null;
    }
}

function configureOutlineShells(options: CharacterSkinOptions) {
    const { model, skinnedRenderers, outlineRoot, setOutlineRoot } = options;
    if (!options.playerOutline) {
        if (outlineRoot?.isValid) {
            outlineRoot.destroy();
        }
        setOutlineRoot(null);
        return;
    }
    if (!model || skinnedRenderers.length <= 0) {
        return;
    }
    if (outlineRoot?.isValid) {
        return;
    }

    const root = new Node('CharacterOutlineShell');
    try {
        root.setParent(model);
    } catch (error) {
        console.warn('[SpeedSwimming] failed to attach character outline root', error);
        root.destroy();
        setOutlineRoot(null);
        return;
    }
    root.setPosition(0, 0, 0);
    root.setRotationFromEuler(0, 0, 0);
    root.setScale(1, 1, 1);
    root.layer = model.layer;
    setOutlineRoot(root);

    loadOutlineShellMaterial(options.outlineWidth ?? OUTLINE_SHELL_WIDTH, (material) => {
        if (!material || !model?.isValid || !root.isValid) {
            root.destroy();
            setOutlineRoot(null);
            return;
        }

        let shellCount = 0;
        for (const source of skinnedRenderers) {
            if (!source.node?.isValid || !source.mesh) {
                continue;
            }

            try {
                const shellNode = new Node(`${source.node.name || 'Skin'}OutlineShell`);
                const worldPosition = new Vec3();
                const worldRotation = new Quat();
                const worldScale = new Vec3();
                source.node.getWorldPosition(worldPosition);
                source.node.getWorldRotation(worldRotation);
                source.node.getWorldScale(worldScale);

                shellNode.setParent(root);
                shellNode.layer = source.node.layer;
                shellNode.setWorldPosition(worldPosition);
                shellNode.setWorldRotation(worldRotation);
                shellNode.setWorldScale(worldScale);

                const outline = shellNode.addComponent(SkinnedMeshRenderer);
                outline.mesh = source.mesh;
                outline.skeleton = source.skeleton;
                outline.skinningRoot = source.skinningRoot || model;
                // Match the source renderer's load-time visibility. Character
                // switching keeps newly instantiated skins hidden until their
                // first posed joint matrices have reached the renderer.
                outline.enabled = source.enabled;
                outline.setUseBakedAnimation(false, true);
                outline.uploadAnimation(null);
                setAllRendererMaterialSlots(source, outline, material);
                shellCount++;
            } catch (error) {
                console.warn('[SpeedSwimming] skipped character outline shell', source.node?.name, error);
            }
        }

        if (shellCount <= 0) {
            root.destroy();
            setOutlineRoot(null);
            return;
        }
        console.log(`[SpeedSwimming] inverted hull normal-outline shells=${shellCount}`);
    });
}

function makeMaterial(name: string, albedo: Color, roughness = 0.58, metallic = 0): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-standard' });
    material.name = name;
    material.setProperty('albedo', albedo);
    material.setProperty('roughness', roughness);
    material.setProperty('metallic', metallic);
    return material;
}

function makeUnlitMaterial(name: string, color: Color): Material {
    const material = new Material();
    material.initialize({ effectName: 'builtin-unlit' });
    material.name = name;
    material.setProperty('mainColor', color);
    return material;
}

function makeSwimmerTextureMaterial(skinColor: Color, suitColor: Color, capColor: Color, robotStyle: boolean, outfit: CharacterSkinOutfit): Material {
    const texture = makeSwimmerClothesTexture(skinColor, suitColor, capColor, outfit);
    const material = new Material();
    material.initialize({ effectName: 'builtin-standard', defines: { USE_ALBEDO_MAP: true } });
    material.name = 'RuntimeLowSwimmerTexture';
    material.setProperty('albedo', new Color(255, 255, 255, 255));
    material.setProperty('albedoMap', texture);
    material.setProperty('roughness', robotStyle ? 0.36 : 0.56);
    material.setProperty('metallic', robotStyle ? 0.16 : 0);
    return material;
}

let outlineShellEffect: EffectAsset | null = null;
let outlineShellLoading = false;
const outlineShellCallbacks: ((effect: EffectAsset | null) => void)[] = [];

function loadOutlineShellMaterial(lineWidth: number, done: (material: Material | null) => void) {
    const make = (effect: EffectAsset | null) => {
        if (!effect) {
            done(null);
            return;
        }
        const material = new Material();
        material.initialize({ effectAsset: effect });
        material.name = 'CharacterInvertedHullOutline';
        material.setProperty('lineWidth', lineWidth);
        material.setProperty('depthBias', 0.02);
        material.setProperty('baseColor', new Color(3, 5, 8, 255));
        done(material);
    };

    if (outlineShellEffect) {
        make(outlineShellEffect);
        return;
    }

    outlineShellCallbacks.push(make);
    if (outlineShellLoading) {
        return;
    }
    outlineShellLoading = true;

    loadRaceAsset(RESOURCE_PATHS.playerOutlineEffect, EffectAsset, (err, effect) => {
        outlineShellLoading = false;
        if (err || !effect) {
            console.warn('[SpeedSwimming] failed to load character outline effect', err);
            while (outlineShellCallbacks.length > 0) {
                outlineShellCallbacks.shift()?.(null);
            }
            return;
        }

        outlineShellEffect = effect;
        while (outlineShellCallbacks.length > 0) {
            outlineShellCallbacks.shift()?.(outlineShellEffect);
        }
    });
}

function makeSwimmerClothesTexture(skinColor: Color, suitColor: Color, capColor: Color, outfit: CharacterSkinOutfit): Texture2D {
    const data = new Uint8Array(SWIMMER_TEXTURE_SIZE * SWIMMER_TEXTURE_SIZE * 4);
    const suitEdge = darkenColor(suitColor, 0.48);

    for (let y = 0; y < SWIMMER_TEXTURE_SIZE; y++) {
        const v = 1 - (y + 0.5) / SWIMMER_TEXTURE_SIZE;
        for (let x = 0; x < SWIMMER_TEXTURE_SIZE; x++) {
            const u = (x + 0.5) / SWIMMER_TEXTURE_SIZE;
            const nx = (u - 0.5) * 2;
            const color = outfit === 'trunksA'
                ? swimmerTrunksTextureColor(nx, v, skinColor, suitColor, capColor, suitEdge)
                : swimmerTextureColor(nx, v, skinColor, suitColor, capColor, suitEdge);
            const index = (y * SWIMMER_TEXTURE_SIZE + x) * 4;
            data[index] = color.r;
            data[index + 1] = color.g;
            data[index + 2] = color.b;
            data[index + 3] = color.a;
        }
    }

    const texture = new Texture2D('RuntimeLowSwimmerClothes');
    texture.create(SWIMMER_TEXTURE_SIZE, SWIMMER_TEXTURE_SIZE, Texture2D.PixelFormat.RGBA8888);
    texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    texture.uploadData(data);
    return texture;
}

function swimmerTrunksTextureColor(nx: number, v: number, skin: Color, suit: Color, cap: Color, suitEdge: Color): Color {
    const ax = Math.abs(nx);
    let color = skin;

    if (v >= 0.520 && v < 0.625 && ax <= 0.38) {
        color = suit;
    }
    if (v >= 0.617 && v < 0.632 && ax <= 0.40) {
        color = suitEdge;
    }
    if (v >= 0.380 && v < 0.560 && ax <= 0.43) {
        color = suit;
    }
    if (v >= 0.376 && v < 0.394 && ax <= 0.45) {
        color = suitEdge;
    }
    if (v >= 0.965 && v <= 1 && ax <= 0.78) {
        color = cap;
    }

    return color;
}

function swimmerTextureColor(nx: number, v: number, skin: Color, suit: Color, cap: Color, suitEdge: Color): Color {
    const ax = Math.abs(nx);
    let color = skin;

    const torsoWidth = 0.38 + clamp((v - 0.54) / 0.30, 0, 1) * 0.22;
    if (v >= 0.42 && v <= 0.91 && ax <= torsoWidth) {
        color = suit;
    }
    if (v >= 0.30 && v < 0.60 && ax <= 0.58) {
        color = suit;
    }
    if (v >= 0.24 && v < 0.47 && ax >= 0.12 && ax <= 0.56) {
        color = suit;
    }
    if (v >= 0.34 && v <= 0.91 && ax >= 0.42 && ax <= 0.98) {
        color = suit;
    }

    if (v >= 0.44 && v <= 0.56 && ax >= 0.58) {
        color = skin;
    }

    if ((v >= 0.902 && v <= 0.915 && ax <= 0.46) || (v >= 0.232 && v <= 0.246 && ax >= 0.12 && ax <= 0.56)) {
        color = suitEdge;
    }
    if (v >= 0.330 && v <= 0.345 && ax >= 0.42 && ax <= 0.98) {
        color = suitEdge;
    }

    if (v >= 0.965 && v <= 1 && ax <= 0.78) {
        color = cap;
    }

    return color;
}

function blendColor(a: Color, b: Color, amount: number): Color {
    const t = clamp(amount, 0, 1);
    return new Color(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t),
        Math.round(a.a + (b.a - a.a) * t),
    );
}

function darkenColor(color: Color, amount: number): Color {
    const t = clamp(amount, 0, 1);
    return new Color(
        Math.round(color.r * t),
        Math.round(color.g * t),
        Math.round(color.b * t),
        color.a,
    );
}

function boostColor(color: Color, saturationScale: number, valueScale: number): Color {
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const value = clamp(max * valueScale, 0, 1);
    const saturation = max <= 0 ? 0 : clamp(((max - min) / max) * saturationScale, 0, 1);
    if (saturation <= 0) {
        const gray = Math.round(value * 255);
        return new Color(gray, gray, gray, color.a);
    }
    const hue = colorHue(r, g, b, max, min);
    const chroma = value * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = value - chroma;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    if (hue < 60) {
        rr = chroma; gg = x;
    } else if (hue < 120) {
        rr = x; gg = chroma;
    } else if (hue < 180) {
        gg = chroma; bb = x;
    } else if (hue < 240) {
        gg = x; bb = chroma;
    } else if (hue < 300) {
        rr = x; bb = chroma;
    } else {
        rr = chroma; bb = x;
    }
    return new Color(
        Math.round((rr + m) * 255),
        Math.round((gg + m) * 255),
        Math.round((bb + m) * 255),
        color.a,
    );
}

function colorHue(r: number, g: number, b: number, max: number, min: number): number {
    const delta = max - min;
    if (delta <= 0) {
        return 0;
    }
    if (max === r) {
        return positiveHue(60 * (((g - b) / delta) % 6));
    }
    if (max === g) {
        return 60 * ((b - r) / delta + 2);
    }
    return 60 * ((r - g) / delta + 4);
}

function positiveHue(value: number): number {
    return value < 0 ? value + 360 : value;
}

function applyMaterialByName(root: Node, names: string[], material: Material): number {
    let count = 0;
    if (names.indexOf(root.name) >= 0) {
        const renderer = root.getComponent(MeshRenderer);
        if (renderer) {
            renderer.setMaterial(material, 0);
            count++;
        }
        const skinned = root.getComponent(SkinnedMeshRenderer);
        if (skinned) {
            skinned.setMaterial(material, 0);
            count++;
        }
    }
    for (const child of root.children) {
        count += applyMaterialByName(child, names, material);
    }
    return count;
}

function setAllRendererMaterialSlots(source: SkinnedMeshRenderer, target: SkinnedMeshRenderer, material: Material) {
    let applied = false;
    for (let i = 0; i < 8; i++) {
        if (source.getSharedMaterial(i)) {
            target.setMaterial(material, i);
            applied = true;
        }
    }
    if (!applied) {
        target.setMaterial(material, 0);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
