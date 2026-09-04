import {
    _decorator,
    AlphaKey,
    builtinResMgr,
    Camera,
    Color,
    ColorKey,
    Component,
    CurveRange,
    Gradient,
    GradientRange,
    geometry,
    Material,
    Node,
    ParticleSystem,
    Texture2D,
    Vec3,
} from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { scaledDelta } from '../core/TimeScale';

const { ccclass } = _decorator;

const PARTICLE_CAPACITY = 16;
const FLASH_LIFETIME = 0.08;
const SIZE_MIN = 0.65;
const SIZE_MAX = 1.05;
const FIRST_DELAY_MIN = 0.05;
const FIRST_DELAY_MAX = 0.25;
const NORMAL_DELAY_MIN = 0.1;
const NORMAL_DELAY_MAX = 0.3;
const CLUSTER_DELAY_MIN = 0.025;
const CLUSTER_DELAY_MAX = 0.07;
const CLUSTER_CHANCE = 0.35;
const DOUBLE_FLASH_CHANCE = 0.25;
const START_DENSITY_MULTIPLIER = 2;
const PROGRESS_DENSITY_BOOST = 1;
const SPRINT_DENSITY_MULTIPLIER = 5;
const DENSITY_BLEND_SPEED = 2.5;
const VISIBILITY_REFRESH_SECONDS = 0.1;
const VISIBILITY_HALF_EXTENT = SIZE_MAX * 0.55;
const SPACE_WORLD = 0;
const RENDER_MODE_BILLBOARD = 0;

let sharedFlashMaterial: Material | null = null;

@ccclass('SpectatorCameraFlashEmitter')
export class SpectatorCameraFlashEmitter extends Component {
    private _positions = new Float32Array(0);
    private _visiblePositionIndices = new Uint16Array(0);
    private _visiblePositionCount = 0;
    private _visibilityCamera: Camera | null = null;
    private _flashTexture: Texture2D | null = null;
    private _emitterNode: Node | null = null;
    private _system: ParticleSystem | null = null;
    private readonly _emitPosition = new Vec3();
    private readonly _visibilityCenter = new Vec3();
    private readonly _visibilityBounds = new geometry.AABB();
    private _visibilityRefreshSeconds = 0;
    private _nextFlashSeconds = 0;
    private _lastPositionIndex = -1;
    private _densityMultiplier = START_DENSITY_MULTIPLIER;
    private _targetDensityMultiplier = START_DENSITY_MULTIPLIER;

    configure(positions: Float32Array) {
        this._positions = positions;
        this._visiblePositionIndices = new Uint16Array(Math.floor(positions.length / 3));
        this._visiblePositionCount = 0;
        if (positions.length < 3) {
            return;
        }
        loadRaceAsset(RESOURCE_PATHS.spectatorCameraFlashTexture, Texture2D, (error, texture) => {
            if (error || !texture) {
                console.warn('[SpeedSwimming] spectator camera flash texture load failed', error);
                return;
            }
            if (!this.node.isValid) {
                return;
            }
            this._flashTexture = texture;
            this.ensureBuilt(texture);
            this._nextFlashSeconds = randomRange(FIRST_DELAY_MIN, FIRST_DELAY_MAX)
                / START_DENSITY_MULTIPLIER;
        });
    }

    setVisibilityCamera(camera: Camera | null) {
        this._visibilityCamera = camera;
        this._visibilityRefreshSeconds = 0;
    }

    setRaceIntensity(progress: number, sprintActive: boolean) {
        const normalizedProgress = Math.max(0, Math.min(1, progress));
        this._targetDensityMultiplier = sprintActive
            ? SPRINT_DENSITY_MULTIPLIER
            : START_DENSITY_MULTIPLIER + normalizedProgress * PROGRESS_DENSITY_BOOST;
    }

    resetRaceIntensity() {
        this._densityMultiplier = START_DENSITY_MULTIPLIER;
        this._targetDensityMultiplier = START_DENSITY_MULTIPLIER;
        this._nextFlashSeconds = randomRange(FIRST_DELAY_MIN, FIRST_DELAY_MAX)
            / START_DENSITY_MULTIPLIER;
    }

    update(dt: number) {
        if (!this._system?.isValid || !this._emitterNode?.isValid || this._positions.length < 3) {
            return;
        }
        const step = scaledDelta(dt);
        if (step <= 0) {
            return;
        }
        this._visibilityRefreshSeconds -= step;
        if (this._visibilityRefreshSeconds <= 0) {
            this.refreshVisiblePositions();
            this._visibilityRefreshSeconds = VISIBILITY_REFRESH_SECONDS;
        }
        this._densityMultiplier += (this._targetDensityMultiplier - this._densityMultiplier)
            * Math.min(1, step * DENSITY_BLEND_SPEED);
        this._nextFlashSeconds -= step;
        if (this._nextFlashSeconds > 0) {
            return;
        }

        const emitCount = Math.random() < DOUBLE_FLASH_CHANCE ? 2 : 1;
        for (let index = 0; index < emitCount; index++) {
            this.emitOne(step);
        }
        this._nextFlashSeconds = Math.random() < CLUSTER_CHANCE
            ? randomRange(CLUSTER_DELAY_MIN, CLUSTER_DELAY_MAX) / this._densityMultiplier
            : randomRange(NORMAL_DELAY_MIN, NORMAL_DELAY_MAX) / this._densityMultiplier;
    }

    protected onDestroy() {
        if (this._system?.isValid) {
            this._system.stop();
        }
        this._positions = new Float32Array(0);
        this._visiblePositionIndices = new Uint16Array(0);
        this._visiblePositionCount = 0;
        this._visibilityCamera = null;
        this._flashTexture = null;
        this._densityMultiplier = START_DENSITY_MULTIPLIER;
        this._targetDensityMultiplier = START_DENSITY_MULTIPLIER;
        this._system = null;
        this._emitterNode = null;
    }

    private refreshVisiblePositions() {
        const frustum = this._visibilityCamera?.camera?.frustum ?? null;
        if (!frustum) {
            this._visiblePositionCount = 0;
            return;
        }
        let visibleCount = 0;
        const positionCount = Math.floor(this._positions.length / 3);
        for (let positionIndex = 0; positionIndex < positionCount; positionIndex++) {
            const offset = positionIndex * 3;
            this._visibilityCenter.set(
                this._positions[offset],
                this._positions[offset + 1],
                this._positions[offset + 2],
            );
            geometry.AABB.set(
                this._visibilityBounds,
                this._visibilityCenter.x,
                this._visibilityCenter.y,
                this._visibilityCenter.z,
                VISIBILITY_HALF_EXTENT,
                VISIBILITY_HALF_EXTENT,
                VISIBILITY_HALF_EXTENT,
            );
            if (geometry.intersect.aabbFrustum(this._visibilityBounds, frustum) !== 0) {
                this._visiblePositionIndices[visibleCount++] = positionIndex;
            }
        }
        this._visiblePositionCount = visibleCount;
    }

    private ensureBuilt(texture: Texture2D) {
        if (this._system?.isValid) {
            return;
        }
        const emitterNode = new Node('SpectatorCameraFlashParticles');
        emitterNode.setParent(this.node);
        emitterNode.layer = this.node.layer;
        this._emitterNode = emitterNode;

        const system = emitterNode.addComponent(ParticleSystem);
        system.capacity = PARTICLE_CAPACITY;
        system.loop = true;
        system.playOnAwake = false;
        system.duration = 1;
        system.simulationSpace = SPACE_WORLD as unknown as ParticleSystem['simulationSpace'];
        system.renderCulling = false;
        setConstant(system.startLifetime, FLASH_LIFETIME);
        setConstant(system.startSpeed, 0);
        setTwoConstants(system.startSizeX, SIZE_MIN, SIZE_MAX);
        setTwoConstants(system.startSizeY, SIZE_MIN, SIZE_MAX);
        setTwoConstants(system.startSizeZ, SIZE_MIN, SIZE_MAX);
        setConstant(system.gravityModifier, 0);
        setConstant(system.rateOverTime, 0);
        setConstant(system.rateOverDistance, 0);
        setColor(system.startColor, Color.WHITE.clone());
        configureAlphaFade(system);

        const shape = system.shapeModule as unknown as { enable?: boolean } | null;
        if (shape) {
            shape.enable = false;
        }
        const textureAnimation = system.textureAnimationModule as unknown as { enable?: boolean } | null;
        if (textureAnimation) {
            textureAnimation.enable = false;
        }
        system.bursts = [];
        system.clear();
        system.play();
        applyFlashRenderer(system, texture);
        this._system = system;
    }

    private emitOne(dt: number) {
        if (this._visiblePositionCount <= 0) {
            return;
        }
        if (!this._system!.isPlaying) {
            this._system!.play();
            applyFlashRenderer(this._system!, this._flashTexture!);
        }
        let visibleSlot = Math.floor(Math.random() * this._visiblePositionCount);
        let positionIndex = this._visiblePositionIndices[visibleSlot];
        if (this._visiblePositionCount > 1 && positionIndex === this._lastPositionIndex) {
            visibleSlot = (visibleSlot + 1 + Math.floor(Math.random() * (this._visiblePositionCount - 1)))
                % this._visiblePositionCount;
            positionIndex = this._visiblePositionIndices[visibleSlot];
        }
        this._lastPositionIndex = positionIndex;
        const offset = positionIndex * 3;
        this._emitPosition.set(
            this._positions[offset],
            this._positions[offset + 1],
            this._positions[offset + 2],
        );
        this._emitterNode!.setWorldPosition(this._emitPosition);
        const system = this._system!;
        (system as unknown as { emit: (count: number, step: number) => void }).emit(1, Math.min(dt, 0.05));
        const processor = system.processor as unknown as {
            getModel?: () => { scene?: unknown } | null;
            attachToScene?: () => void;
        } | null;
        if (!processor?.getModel?.()?.scene) {
            processor?.attachToScene?.();
        }
    }
}

function applyFlashRenderer(system: ParticleSystem, texture: Texture2D) {
    const material = getFlashMaterial(texture);
    system.setSharedMaterial(material, 0);
    const renderer = system.renderer as unknown as {
        useGPU?: boolean;
        renderMode?: number;
        particleMaterial?: Material;
        cpuMaterial?: Material;
        mainTexture?: Texture2D;
    } | null;
    if (!renderer) {
        return;
    }
    renderer.useGPU = false;
    renderer.renderMode = RENDER_MODE_BILLBOARD;
    renderer.particleMaterial = material;
    renderer.cpuMaterial = material;
    renderer.mainTexture = texture;
    system.processor?.updateMaterialParams?.();
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

function setColor(range: GradientRange, color: Color) {
    range.mode = GradientRange.Mode.Color;
    range.color = color;
}

function configureAlphaFade(system: ParticleSystem) {
    const module = system.colorOverLifetimeModule;
    const color = module?.color;
    if (!color) {
        return;
    }
    const startColor = new ColorKey();
    startColor.color = Color.WHITE.clone();
    startColor.time = 0;
    const endColor = new ColorKey();
    endColor.color = Color.WHITE.clone();
    endColor.time = 1;
    const full = new AlphaKey();
    full.alpha = 1;
    full.time = 0;
    const hold = new AlphaKey();
    hold.alpha = 1;
    hold.time = 0.35;
    const faded = new AlphaKey();
    faded.alpha = 0;
    faded.time = 1;
    const gradient = new Gradient();
    gradient.setKeys([startColor, endColor], [full, hold, faded]);
    module.enable = true;
    color.mode = GradientRange.Mode.Gradient;
    color.gradient = gradient;
}

function getFlashMaterial(texture: Texture2D): Material {
    if (sharedFlashMaterial?.isValid) {
        sharedFlashMaterial.setProperty('mainTexture', texture);
        return sharedFlashMaterial;
    }
    const source = builtinResMgr.get<Material>('default-particle-material');
    if (!source) {
        throw new Error('Cocos default particle material is unavailable.');
    }
    const material = new Material();
    material.initialize({
        effectAsset: source.effectAsset,
        technique: source.technique,
        states: {
            depthStencilState: {
                depthTest: false,
                depthWrite: false,
            },
        },
    });
    material.name = 'RuntimeSpectatorCameraFlash';
    material.setProperty('mainTexture', texture);
    material.setProperty('tintColor', Color.WHITE);
    sharedFlashMaterial = material;
    return material;
}

function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}
