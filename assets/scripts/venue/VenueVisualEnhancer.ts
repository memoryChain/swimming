import { Color, Material, MeshRenderer, Node } from 'cc';

const VENUE_SATURATION_SCALE = 1.16;
const VENUE_VALUE_SCALE = 1.0;
const WATER_NODE_NAMES = new Set(['PoolWaterSurface', 'PoolWater_0_50', 'PoolWater_50_100']);
const COLOR_PROPERTIES = ['albedo', 'mainColor', 'baseColor'];

export function brightenVenueMaterials(root: Node): number {
    const materialCache = new Map<Material, Material>();
    return boostNodeMaterials(root, materialCache);
}

function boostNodeMaterials(node: Node, materialCache: Map<Material, Material>): number {
    let applied = 0;
    if (!WATER_NODE_NAMES.has(node.name)) {
        const renderer = node.getComponent(MeshRenderer);
        if (renderer) {
            applied += boostRendererMaterials(renderer, materialCache);
        }
    }

    for (const child of node.children) {
        applied += boostNodeMaterials(child, materialCache);
    }
    return applied;
}

function boostRendererMaterials(renderer: MeshRenderer, materialCache: Map<Material, Material>): number {
    let applied = 0;
    for (let i = 0; i < 8; i++) {
        const source = renderer.getMaterial(i);
        if (!source) {
            continue;
        }
        let material = materialCache.get(source);
        if (!material) {
            material = makeBoostedMaterial(source);
            materialCache.set(source, material);
        }
        renderer.setMaterial(material, i);
        applied++;
    }
    return applied;
}

function makeBoostedMaterial(source: Material): Material {
    const material = new Material();
    material.copy(source);
    material.name = `${source.name || 'Venue'}ColorBoost`;

    for (const property of COLOR_PROPERTIES) {
        const color = getColorProperty(material, property);
        if (color) {
            material.setProperty(property, boostColor(color, VENUE_SATURATION_SCALE, VENUE_VALUE_SCALE));
        }
    }

    return material;
}

function getColorProperty(material: Material, property: string): Color | null {
    try {
        const value = material.getProperty(property);
        return value instanceof Color ? value : null;
    } catch {
        return null;
    }
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

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
