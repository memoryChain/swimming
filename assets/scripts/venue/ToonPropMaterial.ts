import { Color, EffectAsset, Material, MeshRenderer, Node, Texture2D, Vec3, Vec4 } from 'cc';

// Cel-shade a static lit GLB prop (start block, etc.) while keeping its baked
// albedo texture, so it matches the comic-styled swimmers instead of reading as
// a flat realistically-lit surface. The ToonProp effect passes a smooth world
// normal from the vertex stage, so it needs no screen-space derivatives.
export function makeToonPropMaterial(effect: EffectAsset, source: Material | null): Material {
    const material = new Material();
    material.initialize({ effectAsset: effect });
    material.name = `RuntimeToonProp_${source?.name || 'Prop'}`;
    if (source) {
        // GLB standard materials expose the base-colour map as `albedoMap`; fall
        // back to a couple of alternate names so an unexpected importer key still
        // binds instead of leaving the prop untextured white.
        for (const key of ['albedoMap', 'mainTexture', 'baseColorMap']) {
            const texture = readMaterialProperty(source, key);
            if (texture instanceof Texture2D) {
                material.setProperty('mainTexture', texture);
                break;
            }
        }
        material.setProperty('mainColor', readMaterialColor(source));
    }
    return material;
}

// Replace every renderer material under `root` with a shared cel-shaded material
// derived from the first source material found. Returns the shared material so
// callers can batch (all instances then reference the same material) or tweak it.
export function applyToonPropMaterials(root: Node, effect: EffectAsset): Material | null {
    const renderers = root.getComponentsInChildren(MeshRenderer);
    if (renderers.length === 0) {
        return null;
    }
    let shared: Material | null = null;
    for (const renderer of renderers) {
        const source = renderer.sharedMaterials[0] ?? renderer.getSharedMaterial(0);
        if (!shared) {
            shared = makeToonPropMaterial(effect, source ?? null);
        }
        const count = Math.max(1, renderer.sharedMaterials.length);
        for (let i = 0; i < count; i++) {
            renderer.setMaterial(shared, i);
        }
    }
    return shared;
}

// GLB standard materials imported by Cocos store baseColorFactor in `albedoScale`
// (a Vec3/Vec4), while `albedo` stays default white. Read albedoScale first so we
// recover the real prop colour instead of falling back to white.
function readMaterialColor(material: Material): Color {
    const scale = readMaterialProperty(material, 'albedoScale');
    if (scale instanceof Vec4 || scale instanceof Vec3) {
        return new Color(
            clampByte(scale.x * 255),
            clampByte(scale.y * 255),
            clampByte(scale.z * 255),
            255,
        );
    }
    for (const name of ['albedo', 'mainColor', 'baseColor']) {
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
