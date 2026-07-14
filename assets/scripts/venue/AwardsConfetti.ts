import {
    AlphaKey,
    Color,
    ColorKey,
    CurveRange,
    Gradient,
    GradientRange,
    Node,
    ParticleSystem,
    Texture2D,
    Vec3,
} from 'cc';
import { SWIMMER_LAYER } from './WaterSurfaceBinder';

const CONFETTI_ROOT_NAME = 'AwardsConfetti';
const EMITTER_HEIGHT = 4.6;
const EMITTER_WIDTH = 5.2;
const EMITTER_DEPTH = 3.2;
const CONFETTI_RATE = 24;
const CONFETTI_CAPACITY = 128;

let _confettiTexture: Texture2D | null = null;

// One CPU particle system supplies the whole ceremony shower. RandomColor keeps
// all colours in a single material/draw call, while rectangular billboard size,
// spin and lateral velocity make the particles read as fluttering paper strips.
export class AwardsConfetti {
    private _root: Node | null = null;

    show(parent: Node | null, podiumCenter: Vec3) {
        this.hide();
        if (!parent?.isValid) {
            return;
        }

        const root = new Node(CONFETTI_ROOT_NAME);
        root.setParent(parent);
        root.layer = SWIMMER_LAYER;
        root.setWorldPosition(podiumCenter.x, podiumCenter.y + EMITTER_HEIGHT, podiumCenter.z);
        this._root = root;

        const system = root.addComponent(ParticleSystem);
        system.priority = 255;
        system.capacity = CONFETTI_CAPACITY;
        system.loop = true;
        system.prewarm = true;
        system.playOnAwake = false;
        system.duration = 5;
        system.simulationSpace = 0; // ParticleSpace.World
        system.simulationSpeed = 1;
        system.renderCulling = false;
        system.aabbHalfX = 6;
        system.aabbHalfY = 7;
        system.aabbHalfZ = 5;
        system.startSize3D = true;
        setTwoConstants(system.startLifetime, 3.8, 4.7);
        setTwoConstants(system.startSpeed, 0.04, 0.22);
        setTwoConstants(system.startSizeX, 0.10, 0.18);
        setTwoConstants(system.startSizeY, 0.22, 0.34);
        setTwoConstants(system.startSizeZ, 0.10, 0.18);
        setTwoConstants(system.startRotationZ, 0, Math.PI * 2);
        setConstant(system.startDelay, 0);
        setConstant(system.gravityModifier, 0.075);
        setConstant(system.rateOverTime, CONFETTI_RATE);
        setConstant(system.rateOverDistance, 0);
        setRandomConfettiColor(system.startColor);
        setFadeOut(system);
        setFlutter(system);

        const shape = system.shapeModule;
        if (shape) {
            shape.enable = true;
            shape.shapeType = 0; // ParticleShapeType.Box
            shape.emitFrom = 3; // ParticleEmitLocation.Volume
            shape.scale = new Vec3(EMITTER_WIDTH, 0.12, EMITTER_DEPTH);
            shape.randomDirectionAmount = 0.25;
        }

        const renderer = system.renderer as any;
        if (renderer) {
            renderer.useGPU = false;
            renderer.renderMode = 0; // Billboard
            renderer.particleMaterial = null;
            renderer.cpuMaterial = null;
            renderer.mainTexture = getConfettiTexture();
        }
        system.setSharedMaterial(null, 0);
        system.clear();
        system.play();
    }

    hide() {
        if (this._root?.isValid) {
            const system = this._root.getComponent(ParticleSystem);
            system?.stop();
            system?.clear();
            this._root.destroy();
        }
        this._root = null;
    }
}

function setFlutter(system: ParticleSystem) {
    const velocity = system.velocityOvertimeModule;
    if (velocity) {
        velocity.enable = true;
        velocity.space = 0; // ParticleSpace.World
        setTwoConstants(velocity.x, -0.48, 0.48);
        setTwoConstants(velocity.y, -0.12, 0.04);
        setTwoConstants(velocity.z, -0.38, 0.38);
        setConstant(velocity.speedModifier, 1);
    }

    const rotation = system.rotationOvertimeModule;
    if (rotation) {
        rotation.enable = true;
        rotation.separateAxes = false;
        setTwoConstants(rotation.z, -3.8, 3.8);
    }
}

function setRandomConfettiColor(range: GradientRange) {
    const colors = [
        new Color(255, 66, 88, 255),
        new Color(255, 210, 55, 255),
        new Color(67, 220, 125, 255),
        new Color(56, 170, 255, 255),
        new Color(166, 92, 255, 255),
        new Color(255, 125, 48, 255),
    ];
    const colorKeys = colors.map((value, index) => {
        const key = new ColorKey();
        key.color = value;
        key.time = colors.length <= 1 ? 0 : index / (colors.length - 1);
        return key;
    });
    const startAlpha = new AlphaKey();
    startAlpha.alpha = 1;
    startAlpha.time = 0;
    const endAlpha = new AlphaKey();
    endAlpha.alpha = 1;
    endAlpha.time = 1;
    const gradient = new Gradient();
    gradient.setKeys(colorKeys, [startAlpha, endAlpha]);
    range.mode = GradientRange.Mode.RandomColor;
    range.gradient = gradient;
}

function setFadeOut(system: ParticleSystem) {
    const module = system.colorOverLifetimeModule;
    if (!module?.color) {
        return;
    }
    const startColor = new ColorKey();
    startColor.color = Color.WHITE.clone();
    startColor.time = 0;
    const endColor = new ColorKey();
    endColor.color = Color.WHITE.clone();
    endColor.time = 1;
    const startAlpha = new AlphaKey();
    startAlpha.alpha = 1;
    startAlpha.time = 0;
    const holdAlpha = new AlphaKey();
    holdAlpha.alpha = 1;
    holdAlpha.time = 0.78;
    const endAlpha = new AlphaKey();
    endAlpha.alpha = 0;
    endAlpha.time = 1;
    const gradient = new Gradient();
    gradient.setKeys([startColor, endColor], [startAlpha, holdAlpha, endAlpha]);
    module.enable = true;
    module.color.mode = GradientRange.Mode.Gradient;
    module.color.gradient = gradient;
}

function getConfettiTexture(): Texture2D {
    if (_confettiTexture) {
        return _confettiTexture;
    }
    const width = 8;
    const height = 16;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const offset = i * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
    }
    const texture = new Texture2D('RuntimeAwardsConfetti');
    texture.create(width, height, Texture2D.PixelFormat.RGBA8888);
    texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    texture.uploadData(data);
    _confettiTexture = texture;
    return texture;
}

function setConstant(range: CurveRange, value: number) {
    range.mode = CurveRange.Mode.Constant;
    range.constant = value;
}

function setTwoConstants(range: CurveRange, min: number, max: number) {
    range.mode = CurveRange.Mode.TwoConstants;
    range.constantMin = min;
    range.constantMax = max;
}
