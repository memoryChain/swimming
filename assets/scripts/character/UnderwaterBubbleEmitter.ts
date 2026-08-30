import {
    AlphaKey,
    builtinResMgr,
    Color,
    ColorKey,
    CurveRange,
    Gradient,
    GradientRange,
    ImageAsset,
    Material,
    Node,
    ParticleSystem,
    RealCurve,
    Texture2D,
    Vec3,
} from 'cc';

// Friction/turbulence bubbles left in the WAKE of a SUBMERGED swimmer as the body
// moves through the water (dive glide / flip turn / dolphin kick / the underwater
// debug scene). These are NOT breath bubbles from the mouth, and they do NOT
// follow the flailing limbs: they are born at the body and stay put in the water
// (World-space simulation) so the swimmer leaves them BEHIND as a trail, with only
// the faintest upward drift.
//
// WeChat budget: the player uses the detailed body wake; background swimmers use
// one underwater point plus one low-rate surface-wake point. Emission is gated
// to underwater phases, so the normal above-water race pays only a boolean comparison.

export type UnderwaterBubbleOptions = {
    // A stable world-space node already tagged onto the swimmer overlay layer (the
    // SplashEmitter node). Bubbles parent under it so the overlay camera draws
    // them over the opaque underwater surface, and the periodic layer re-tag
    // reaches them for free.
    parent: Node;
    name: string;
    // Resolve a swimmer bone world position by name (Body/LeftHand/RightHand/
    // LeftFoot/RightFoot/...). Same getter the SplashEmitter uses.
    getBoneWorldPosition: (name: string, out: Vec3) => boolean;
    getWaterY?: () => number;
    // AI/remote LOD: two low-rate sources instead of the detailed body wake.
    reduced?: boolean;
};

// Emit points with per-point rate/radius/capacity. Spread across the MOVING body
// from hands to feet — NOT a fixed torso point (that pumps an obvious hip stream).
// Points can be a single bone or the MIDPOINT between two bones (bone2/mix) so we
// can fill in the hips and shins where there is no dedicated bone. Every point
// moves with the swimming motion, so foam sheds all along the churning body and
// no single source stands out. World-space simulation (below) leaves every speck
// in the water as the body swims on, so it all trails BEHIND. Many tiny SOFT
// specks (foam), not distinct soap bubbles.
type EmitConfig = {
    bone: string;
    bone2?: string;
    mix?: number;
    rate: number;
    radius: number;
    capacity: number;
    surfaceWake?: boolean;
};
const EMIT_POINTS: EmitConfig[] = [
    { bone: 'LeftHand', rate: 10, radius: 0.16, capacity: 22 },
    { bone: 'RightHand', rate: 10, radius: 0.16, capacity: 22 },
    { bone: 'Body', bone2: 'LeftLeg', mix: 0.5, rate: 11, radius: 0.2, capacity: 24 },
    { bone: 'Body', bone2: 'RightLeg', mix: 0.5, rate: 11, radius: 0.2, capacity: 24 },
    { bone: 'LeftLeg', rate: 11, radius: 0.2, capacity: 24 },
    { bone: 'RightLeg', rate: 11, radius: 0.2, capacity: 24 },
    { bone: 'LeftLeg', bone2: 'LeftFoot', mix: 0.5, rate: 11, radius: 0.18, capacity: 24 },
    { bone: 'RightLeg', bone2: 'RightFoot', mix: 0.5, rate: 11, radius: 0.18, capacity: 24 },
    { bone: 'Foot', rate: 13, radius: 0.18, capacity: 28 },
    { bone: 'Body', rate: 5, radius: 0.2, capacity: 16, surfaceWake: true },
];
const REDUCED_EMIT_POINTS: EmitConfig[] = [
    { bone: 'Foot', rate: 7, radius: 0.16, capacity: 18 },
    { bone: 'Body', rate: 4, radius: 0.18, capacity: 12, surfaceWake: true },
];

// Tiny soft foam specks with low alpha, so lots of overlapping specks read as a
// soft foamy wake rather than a few obvious bubbles.
const LIFETIME_MIN = 0.9;
const LIFETIME_MAX = 1.7;
const SPEED_MIN = 0.01;
const SPEED_MAX = 0.05;
// Barely any upward drift (friction foam just lingers and rises a hair). The
// dominant motion is the body swimming away from it (World space). gravityModifier
// is a multiplier on scene gravity; negative = a tiny push toward +Y (world up).
const GRAVITY = -0.015;
const SIZE_MIN = 0.018;
const SIZE_MAX = 0.05;
const ALPHA = 165;
const RENDER_PRIORITY = 255;
// ParticleSystem.Space enum: World = 0, Local = 1, Custom = 2. MUST be World so
// each speck stays where it was born in the water and the swimmer leaves it
// behind (a wake), instead of the whole cloud following the emitter.
const SPACE_WORLD = 0;
// ShapeModule.shapeType: 0 Box, 1 Circle, 2 Cone, 3 Sphere.
const SHAPE_SPHERE = 3;

let _sharedBubbleTexture: Texture2D | null = null;
let _sharedBubbleMaterial: Material | null = null;

type BubblePoint = {
    node: Node;
    system: ParticleSystem;
    boneName: string;
    boneName2: string | null;
    mix: number;
    rate: number;
    surfaceWake: boolean;
};

export class UnderwaterBubbleEmitter {
    node: Node = null;
    private readonly _points: BubblePoint[] = [];
    private readonly _tmp = new Vec3();
    private readonly _tmp2 = new Vec3();
    private _emitting = false;
    private _surfaceWake = false;
    private _visible = true;
    private readonly _options: UnderwaterBubbleOptions;

    constructor(options: UnderwaterBubbleOptions) {
        this._options = options;
    }

    build() {
        const root = new Node(this._options.name || 'UnderwaterBubbles');
        root.setParent(this._options.parent);
        root.layer = this._options.parent.layer;
        root.setPosition(0, 0, 0);
        this.node = root;

        const emitPoints = this._options.reduced ? REDUCED_EMIT_POINTS : EMIT_POINTS;
        for (const cfg of emitPoints) {
            const node = new Node(`Bubble_${cfg.bone}`);
            node.setParent(root);
            node.layer = root.layer;
            node.setPosition(0, 0, 0);
            const system = this.configureSystem(node, cfg);
            this._points.push({
                node,
                system,
                boneName: cfg.bone,
                boneName2: cfg.bone2 ?? null,
                mix: cfg.mix ?? 0.5,
                rate: cfg.rate,
                surfaceWake: !!cfg.surfaceWake,
            });
        }
    }

    private configureSystem(node: Node, cfg: EmitConfig): ParticleSystem {
        const system = node.addComponent(ParticleSystem);
        system.priority = RENDER_PRIORITY;
        system.capacity = cfg.capacity;
        system.loop = true;
        system.playOnAwake = false;
        system.duration = 5;
        system.simulationSpace = SPACE_WORLD as unknown as ParticleSystem['simulationSpace'];
        system.renderCulling = false;
        system.aabbHalfX = 4;
        system.aabbHalfY = 4;
        system.aabbHalfZ = 4;
        setTwoConstants(system.startLifetime, LIFETIME_MIN, LIFETIME_MAX);
        setTwoConstants(system.startSpeed, SPEED_MIN, SPEED_MAX);
        setTwoConstants(system.startSizeX, SIZE_MIN, SIZE_MAX);
        setTwoConstants(system.startSizeY, SIZE_MIN, SIZE_MAX);
        setTwoConstants(system.startSizeZ, SIZE_MIN, SIZE_MAX);
        setConstant(system.gravityModifier, GRAVITY);
        // Gated: start closed, opened by setEmitting while underwater.
        setConstant(system.rateOverTime, 0);
        setConstant(system.rateOverDistance, 0);
        setGradientColor(system.startColor, new Color(255, 255, 255, ALPHA));
        setAlphaFade(system);
        setSizeGrow(system);

        const shape = system.shapeModule as any;
        if (shape) {
            shape.enable = true;
            shape.shapeType = SHAPE_SPHERE;
            shape.radius = cfg.radius;
            shape.randomDirectionAmount = 1;
        }
        const texAnim = system.textureAnimationModule as any;
        if (texAnim) {
            texAnim.enable = false;
        }
        applyBubbleTexture(system);
        system.bursts = [];
        system.clear();
        return system;
    }

    // Open/close emission on the underwater edge. Only writes on change so the
    // above-water race path is a single boolean compare.
    setEmitting(active: boolean, surfaceWake = false) {
        if (active === this._emitting && surfaceWake === this._surfaceWake) {
            return;
        }
        this._emitting = active;
        this._surfaceWake = surfaceWake;
        for (const point of this._points) {
            const pointActive = active && (!point.surfaceWake || surfaceWake);
            setConstant(point.system.rateOverTime, pointActive ? point.rate : 0);
            if (pointActive && !point.system.isPlaying) {
                point.system.play();
            }
        }
    }

    // Move each limb emitter to its bone each frame (world position). World-space
    // simulation then leaves the bubbles behind as the body swims forward.
    updatePositions() {
        for (const point of this._points) {
            if (!point.node.isValid) {
                continue;
            }
            if (!this._options.getBoneWorldPosition(point.boneName, this._tmp)) {
                continue;
            }
            // Midpoint between two bones (fills hips/shins that have no own bone).
            if (point.boneName2 && this._options.getBoneWorldPosition(point.boneName2, this._tmp2)) {
                Vec3.lerp(this._tmp, this._tmp, this._tmp2, point.mix);
            }
            if (point.surfaceWake && this._options.getWaterY) {
                this._tmp.y = this._options.getWaterY();
            }
            point.node.setWorldPosition(this._tmp);
        }
    }

    setVisible(visible: boolean) {
        if (visible === this._visible || !this.node) {
            return;
        }
        this._visible = visible;
        this.node.active = visible;
    }

    setCulled(culled: boolean) {
        if (!this.node || this._visible === !culled) {
            return;
        }
        if (culled) {
            this.setEmitting(false);
            for (const point of this._points) {
                point.system.stop();
                point.system.clear();
            }
        }
        this.setVisible(!culled);
    }

    dispose() {
        for (const point of this._points) {
            if (point.system && point.system.isValid) {
                point.system.stop();
            }
        }
        this._points.length = 0;
        if (this.node && this.node.isValid) {
            this.node.destroy();
        }
        this.node = null;
    }
}

function setConstant(range: CurveRange, value: number) {
    if (!range) {
        return;
    }
    range.mode = CurveRange.Mode.Constant;
    range.constant = value;
}

function setTwoConstants(range: CurveRange, min: number, max: number) {
    if (!range) {
        return;
    }
    range.mode = CurveRange.Mode.TwoConstants;
    range.constantMin = min;
    range.constantMax = max;
}

function setGradientColor(range: GradientRange, color: Color) {
    if (!range) {
        return;
    }
    range.mode = GradientRange.Mode.Color;
    range.color = color;
}

function setAlphaFade(system: ParticleSystem) {
    const module = system.colorOverLifetimeModule;
    if (!module?.color) {
        return;
    }
    const startColor = new ColorKey();
    startColor.color = new Color(255, 255, 255, 255);
    startColor.time = 0;
    const endColor = new ColorKey();
    endColor.color = new Color(255, 255, 255, 255);
    endColor.time = 1;
    const a0 = new AlphaKey(); a0.alpha = 0; a0.time = 0;
    const a1 = new AlphaKey(); a1.alpha = 1; a1.time = 0.18;
    const a2 = new AlphaKey(); a2.alpha = 1; a2.time = 0.65;
    const a3 = new AlphaKey(); a3.alpha = 0; a3.time = 1;
    const gradient = new Gradient();
    gradient.setKeys([startColor, endColor], [a0, a1, a2, a3]);

    module.enable = true;
    module.color.mode = GradientRange.Mode.Gradient;
    module.color.gradient = gradient;
}

function setSizeGrow(system: ParticleSystem) {
    const module = system.sizeOvertimeModule;
    if (!module?.size) {
        return;
    }
    const curve = new RealCurve();
    curve.assignSorted([[0, 0.7], [1, 1.15]]);
    module.enable = true;
    module.separateAxes = false;
    module.size.mode = CurveRange.Mode.Curve;
    module.size.spline = curve;
    module.size.multiplier = 1;
}

function applyBubbleTexture(system: ParticleSystem) {
    const texture = getBubbleTexture();
    const material = getBubbleMaterial(texture);
    const renderer = system.renderer as any;
    if (renderer) {
        renderer.useGPU = false;
        renderer.renderMode = 0; // billboard
        renderer.cpuMaterial = material;
        renderer.mainTexture = texture;
        system.processor?.updateMaterialParams?.();
    }
}

function getBubbleMaterial(texture: Texture2D): Material {
    if (_sharedBubbleMaterial && _sharedBubbleMaterial.isValid) {
        _sharedBubbleMaterial.setProperty('mainTexture', texture);
        return _sharedBubbleMaterial;
    }
    const defaultParticleMaterial = builtinResMgr.get<Material>('default-particle-material');
    if (!defaultParticleMaterial) {
        throw new Error('Cocos default particle material is unavailable.');
    }
    const material = new Material();
    material.copy(defaultParticleMaterial);
    material.name = 'RuntimeUnderwaterBubble';
    material.setProperty('mainTexture', texture);
    _sharedBubbleMaterial = material;
    return material;
}

function getBubbleTexture(): Texture2D {
    if (_sharedBubbleTexture && _sharedBubbleTexture.isValid) {
        return _sharedBubbleTexture;
    }
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x - c) / c;
            const dy = (y - c) / c;
            const r = Math.sqrt(dx * dx + dy * dy);
            // Soft round foam speck: a plain gaussian white dot (NO hollow rim, NO
            // specular highlight) so it reads as foam, not a kid's soap bubble.
            const g = Math.exp(-(r * r) / (2 * 0.40 * 0.40));
            const outer = 1 - smoothstep(0.9, 1.0, r);
            const a = g * outer;
            const i = (y * size + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.round(255 * a);
        }
    }
    const image = new ImageAsset({
        width: size,
        height: size,
        _data: data,
        _compressed: false,
        format: Texture2D.PixelFormat.RGBA8888,
    });
    const texture = new Texture2D();
    texture.image = image;
    _sharedBubbleTexture = texture;
    return texture;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 1e-5)));
    return t * t * (3 - 2 * t);
}
