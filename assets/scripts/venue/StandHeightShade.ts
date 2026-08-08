import { Color, Mat4, Material, MeshRenderer, Node, Texture2D, gfx, utils, Vec3 } from 'cc';

// Runtime "arena dimming" pass: darken the grandstand / structure geometry by
// BOTH height and horizontal distance from the pool, PER-VERTEX, so the venue
// reads like the reference photo (bright poolside, fading dark toward the top
// and the far corners). Pool/water/lane-floats/swimmers stay bright (unlit).
//
// Why per-vertex (not per-node): several stands are merged into single meshes
// (CornerStands_Merged, StandStructure_Merged, ...). A per-node single colour
// can't represent geometry spread across both far corners, and can't keep the
// poolside front bright while darkening the back. So we rebuild each stand mesh
// with a vertex-colour gradient and draw it unlit + USE_VERTEX_COLOR.
//
// Trade-off: rebuilding meshes + swapping to unlit breaks the static batching
// the GLB was merged for (a few extra draw calls). Fine for the preview; bake
// the same gradient into GLB vertex colours later (方案A) if we want batching.

// Node-name keywords that count as "stands / arena structure" (lowercased,
// matched as substrings so merged nodes like CornerStands_Merged / StandStructure_Merged
// are covered too).
const STAND_KEYWORDS = [
    'bleacher',
    'grandstand',
    'stand',        // standstructure / standsupport / standsoffit / standbackwall / cornerstand
    'corner',       // cornerbackwall / cornersoffit / cornerstand (incl. *_Merged)
    'olympicpanel',
];

// Pool footprint in world space (cocos): X[0,50], Z[±half].
const POOL_MIN_X = 0;
const POOL_MAX_X = 50;
const POOL_HALF_Z = 10.5;

// Horizontal distance (m) within which stands are NOT darkened at all, so the
// first tier's poolside white railing stays bright.
const NEAR_KEEP_M = 6;

// Source-material texture uniforms to carry over onto the unlit shaded material.
const TEXTURE_KEYS = ['emissiveMap', 'albedoMap', 'mainTexture'];

const _p = new Vec3();
const _pw = new Vec3();
const _mat = new Mat4();
const _corner = new Vec3();

export interface StandHeightShadeOptions {
    // Brightness multiplier at the poolside baseline (1 = unchanged).
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

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

function isStandNode(name: string): boolean {
    const lower = name.toLowerCase();
    return STAND_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// Wall / structure nodes (backwall, supports, soffits, upper platform) are the
// bland grey pieces. Give them a muted blue-GREY tint (RGB kept close together
// so it stays desaturated) that's distinct from the stands' saturated blue,
// times the height gradient.
const WALL_TINT = new Color(78, 98, 126);

function isWallNode(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.includes('standstructure') || lower.includes('upperplatform');
}

// Horizontal distance from a point to the pool rectangle (0 while over the
// water/deck, growing as you move out toward the stands and corners).
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

function makeShadedMaterial(source: Material | null, tint: Color | null): Material {
    // A tinted wall ignores its (greyish) source texture/colour and uses the
    // flat tint; other stands keep their original colour/texture.
    const texture = tint ? null : findMaterialTexture(source);
    const material = new Material();
    material.initialize({
        effectName: 'builtin-unlit',
        defines: texture
            ? { USE_VERTEX_COLOR: true, USE_TEXTURE: true }
            : { USE_VERTEX_COLOR: true },
        // Some stands (south side, SE corner) are mirrored (negative scale /
        // baked-mirrored winding), so single-sided culling would drop them.
        // Render double-sided to keep every stand visible.
        states: { rasterizerState: { cullMode: gfx.CullMode.NONE } },
    });
    material.name = 'RuntimeStandShade';
    material.setProperty('mainColor', tint ? tint.clone() : readVisibleColor(source));
    if (texture) {
        material.setProperty('mainTexture', texture);
    }
    return material;
}

// First pass: world-space height range + max horizontal pool distance, from each
// renderer's bounding-box corners (cheap, no mesh read).
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

// Rebuild `renderer`'s mesh with a per-vertex brightness gradient and draw it
// unlit as child nodes (one per sub-mesh). Returns the number of children made.
function shadeRendererVertices(
    renderer: MeshRenderer,
    brightnessAt: (x: number, y: number, z: number) => number,
): number {
    const mesh = renderer.mesh;
    if (!mesh) {
        return 0;
    }
    const node = renderer.node;
    const tint = isWallNode(node.name) ? WALL_TINT : null;
    node.getWorldMatrix(_mat);
    const subCount = Math.max(1, renderer.sharedMaterials.length);
    let made = 0;
    for (let sub = 0; sub < subCount; sub++) {
        let geometry: ReturnType<typeof utils.readMesh>;
        try {
            geometry = utils.readMesh(mesh, sub);
        } catch (error) {
            continue;
        }
        const positions = geometry.positions;
        if (!positions || positions.length <= 0) {
            continue;
        }
        const vertexCount = positions.length / 3;
        const colors: number[] = new Array(vertexCount * 4);
        for (let v = 0; v < vertexCount; v++) {
            _p.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
            Vec3.transformMat4(_pw, _p, _mat);
            const b = brightnessAt(_pw.x, _pw.y, _pw.z);
            colors[v * 4] = b;
            colors[v * 4 + 1] = b;
            colors[v * 4 + 2] = b;
            colors[v * 4 + 3] = 1;
        }
        geometry.colors = colors;
        let shadedMesh;
        try {
            shadedMesh = utils.createMesh(geometry);
        } catch (error) {
            continue;
        }
        const child = new Node(`${node.name}_shade${sub}`);
        child.layer = node.layer;
        node.addChild(child);
        child.setPosition(0, 0, 0);
        child.setRotationFromEuler(0, 0, 0);
        child.setScale(1, 1, 1);
        const childRenderer = child.addComponent(MeshRenderer);
        childRenderer.mesh = shadedMesh;
        childRenderer.setMaterial(makeShadedMaterial(renderer.getSharedMaterial(sub), tint), 0);
        made += 1;
    }
    if (made > 0) {
        // Hide the original bright renderer; the shaded children replace it.
        renderer.enabled = false;
    }
    return made;
}

// Darken stands per-vertex by height AND horizontal distance from the pool.
export function applyStandHeightShade(
    pool: Node | null,
    options?: StandHeightShadeOptions,
    debug?: (message: string) => void,
): number {
    if (!pool?.isValid) {
        return 0;
    }
    const bottom = options?.bottomBrightness ?? 1.0;
    const top = options?.topBrightness ?? 0.15;
    const heightCurve = options?.heightCurve ?? 0.7;
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

    const brightnessAt = (x: number, y: number, z: number): number => {
        const heightT = Math.pow(clamp01((y - minY) / spanY), heightCurve);
        const dist = horizontalPoolDistance(x, z);
        const distT = Math.pow(clamp01((dist - nearKeep) / spanDist), distanceCurve);
        // Being either high OR far from the pool darkens the vertex.
        const combined = clamp01(Math.max(heightT, distT));
        return bottom + (top - bottom) * combined;
    };

    let children = 0;
    for (const renderer of renderers) {
        children += shadeRendererVertices(renderer, brightnessAt);
    }
    debug?.(`stand shade matched ${renderers.length} (${children} sub-meshes): ${names.join(', ')}`);
    return renderers.length;
}
