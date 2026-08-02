import { AlphaKey, builtinResMgr, Color, ColorKey, CurveRange, Gradient, GradientRange, Material, MeshRenderer, Node, ParticleSystem, primitives, RealCurve, Texture2D, utils, Vec3, Vec4 } from 'cc';
import { loadRaceAsset } from '../core/RaceBundleLoader';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
import { STROKE_QUALITY_TUNING } from '../core/InputTuning';
import { WATER_SURFACE_LAYER } from '../venue/WaterSurfaceBinder';
import { SplashFoamPartTuning, SplashParticleEmitterTuning, SPLASH_EMITTER_TUNING, SplashVec3 } from './SplashEmitterTuning';

type SplashPart = {
    node: Node;
    material: Material;
    params: Vec4;
    shapeParams: Vec4;
    seed: number;
    basePosition: Vec3;
    baseEuler: Vec3;
    baseScale: Vec3;
    speedWeight: number;
    armWeight: number;
    kickWeight: number;
    burstWeight: number;
    rippleTime: number;
    lastHandEntry: number;
    frozenWorldPosition: Vec3;
};

type SplashParticleEmitter = {
    node: Node;
    system: ParticleSystem;
    role: 'hand' | 'leg' | 'body';
    visual: SplashParticleEmitterTuning['visual'];
    side: 'left' | 'right';
    basePosition: Vec3;
    palmOffset: Vec3;
    forwardTilt: number;
    lateralTilt: number;
    countScale: number;
    sizeScale: number;
    heightScale: number;
    sprayTime: number;
    sprayRate: number;
    sprayCarry: number;
    lastContact: number;
    cooldown: number;
    keepAlive: number;
};

export type SplashEmitterState = {
    armAction: number;
    kickAction: number;
    armCycleMotion: number;
    kickCycleMotion: number;
    movementDirection: number;
    // Steering heading in radians (0 = straight down the lane). The splash rig yaws
    // by this so the foam and spray follow where the swimmer actually points.
    movementHeadingRadians: number;
    legSplashSuppressed: boolean;
    leftHandWaterContact: number;
    rightHandWaterContact: number;
    leftHandWaterEntry: number;
    rightHandWaterEntry: number;
    leftHandWaterProgress: number;
    rightHandWaterProgress: number;
};

export type SplashEmitterOptions = {
    owner: Node;
    parent: Node;
    name: string;
    waterY: number;
    getBoneWorldPosition: (name: string, out: Vec3) => boolean;
    // Reduced LOD: background AI swimmers create only a few particle systems instead of the full set.
    // 精简 LOD：背景 AI 选手只创建少量粒子系统，而非整套。
    reduced?: boolean;
};

const EMPTY_STATE: SplashEmitterState = {
    armAction: 0,
    kickAction: 0,
    armCycleMotion: 0,
    kickCycleMotion: 0,
    movementDirection: 1,
    movementHeadingRadians: 0,
    legSplashSuppressed: false,
    leftHandWaterContact: 0,
    rightHandWaterContact: 0,
    leftHandWaterEntry: 0,
    rightHandWaterEntry: 0,
    leftHandWaterProgress: 0,
    rightHandWaterProgress: 0,
};

let _splashParticleTexture: Texture2D | null = null;
let _splashSprayTexture: Texture2D | null = null;
const _splashParticleMaterials: Partial<Record<SplashParticleEmitterTuning['visual'], Material>> = {};
const TUNING = SPLASH_EMITTER_TUNING;

export class SplashEmitter {
    public readonly node: Node;

    private readonly _parts: SplashPart[] = [];
    private readonly _particleEmitters: SplashParticleEmitter[] = [];
    private readonly _tmpWorld = new Vec3();
    private readonly _tmpLocal = new Vec3();
    private readonly _tmpEmitPosition = new Vec3();
    private readonly _tmpEmitEuler = new Vec3();
    private _state: SplashEmitterState = EMPTY_STATE;
    private _splashBurst = 0;
    private _armSplashBurst = 0;
    private _kickSplashBurst = 0;
    private _kickParticleBurstPending = false;
    private _lastDt = TUNING.initialDt;
    private _waterY: number;
    private _culled = false;
    private _particleEffectsEnabled = true;
    private _countSpeedFactor = 1;
    private readonly _reduced: boolean;

    constructor(private readonly _options: SplashEmitterOptions) {
        this._waterY = _options.waterY;
        this._reduced = _options.reduced === true;
        this.node = new Node(_options.name);
        this.node.setParent(_options.parent);
        this.node.setPosition(_options.owner.position.x, this._waterY, _options.owner.position.z);
        this.node.setScale(1, 1, 1);
        this.node.active = true;
    }

    build() {
        loadRaceAsset(RESOURCE_PATHS.swimmerSplashMaterial, Material, (err, material) => {
            if (err || !material || !this.node?.isValid) {
                console.warn('[SpeedSwimming] failed to load swimmer splash material', err);
                return;
            }
            loadRaceAsset(RESOURCE_PATHS.swimmerSplashParticleTexture, Texture2D, (textureError, texture) => {
                if (textureError || !texture || !this.node?.isValid) {
                    console.warn('[SpeedSwimming] failed to load swimmer splash particle texture', textureError);
                    return;
                }
                _splashParticleTexture = texture;
                loadRaceAsset(RESOURCE_PATHS.swimmerSplashSprayTexture, Texture2D, (sprayTextureError, sprayTexture) => {
                    if (sprayTextureError || !sprayTexture || !this.node?.isValid) {
                        console.warn('[SpeedSwimming] failed to load swimmer splash spray texture', sprayTextureError);
                        return;
                    }
                    _splashSprayTexture = sprayTexture;
                    this._parts.length = 0;
                    const reduced = this._reduced;
                    if (!(reduced && TUNING.particleEmitters.reduced.disableFoam)) {
                        for (const part of TUNING.foam.parts) {
                            if (reduced && part.ripple) {
                                continue;
                            }
                            this.createPart(material, part);
                        }
                    }
                    this.createParticleEmitterCluster('LeftHandSplashParticles', 'left', TUNING.particleEmitters.leftHandZ);
                    this.createParticleEmitterCluster('RightHandSplashParticles', 'right', TUNING.particleEmitters.rightHandZ);
                    this.createLegParticleEmitter('LeftLowerLegSplashParticles', 'left', TUNING.particleEmitters.leftLegZ);
                    this.createLegParticleEmitter('RightLowerLegSplashParticles', 'right', TUNING.particleEmitters.rightLegZ);
                    if (!(reduced && !TUNING.particleEmitters.reduced.enableBody)) {
                        this.createBodyParticleEmitter('LeftBodySplashParticles', 'left', TUNING.particleEmitters.leftBodyZ);
                        this.createBodyParticleEmitter('RightBodySplashParticles', 'right', TUNING.particleEmitters.rightBodyZ);
                    }
                    this.update(0);
                });
            });
        });
    }

    triggerArmStroke() {
        if (this._culled) {
            return;
        }
        this._armSplashBurst = Math.max(this._armSplashBurst, TUNING.burst.armStroke);
        this._splashBurst = Math.max(this._splashBurst, TUNING.burst.armGeneric);
    }

    triggerKick() {
        if (this._culled) {
            return;
        }
        this._kickSplashBurst = Math.max(this._kickSplashBurst, TUNING.burst.kick);
        this._splashBurst = Math.max(this._splashBurst, TUNING.burst.kickGeneric);
        this._kickParticleBurstPending = true;
    }

    triggerBurst(scale = 1) {
        if (this._culled) {
            return;
        }
        const safeScale = Math.max(0, scale);
        this._splashBurst = Math.max(this._splashBurst, safeScale);
        this._armSplashBurst = Math.max(this._armSplashBurst, safeScale * TUNING.burst.armScale);
        this._kickSplashBurst = Math.max(this._kickSplashBurst, safeScale * TUNING.burst.kickScale);
        this.update(TUNING.triggerBurstUpdateSpeed);
    }

    // Big one-shot surface plume for the dolphin-jump take-off and landing. Unlike
    // triggerBurst (which only feeds the foam/spray signals and relies on the
    // hand/leg entry edges to actually spawn particles), this fires an immediate
    // exaggerated particle plume from EVERY emitter — hands, legs and body — at the
    // fast particle profile, bypassing the entry gating and the leg-splash
    // suppression that is active mid-jump. The leg emitters' continuous spray is
    // still cleared next frame by the suppression, so no spray trails into the air.
    triggerBigSurfaceBurst(scale = 1) {
        if (this._culled) {
            return;
        }
        const safeScale = Math.max(0, scale);
        this._splashBurst = Math.max(this._splashBurst, safeScale);
        this._armSplashBurst = Math.max(this._armSplashBurst, safeScale * TUNING.burst.armScale);
        this._kickSplashBurst = Math.max(this._kickSplashBurst, safeScale * TUNING.burst.kickScale);
        if (this._particleEffectsEnabled) {
            for (const emitter of this._particleEmitters) {
                const base = emitter.role === 'leg'
                    ? TUNING.behavior.legBurstCountMax
                    : emitter.role === 'body'
                        ? TUNING.behavior.bodyBurstCountMax
                        : TUNING.behavior.handBurstCountMax;
                const count = Math.max(1, Math.round(base * safeScale));
                // speedRatio 1 = biggest/fastest particle profile; pullScale = safeScale
                // pushes the plume higher/faster for an exaggerated "山峰" spray.
                this.playParticleBurst(emitter, count, 1, safeScale);
            }
        }
        this.node.active = true;
        this.update(TUNING.triggerBurstUpdateSpeed);
    }

    decay(dt: number) {
        if (this._culled) {
            return;
        }
        this._lastDt = dt > 0 ? dt : this._lastDt;
        this._splashBurst = Math.max(0, this._splashBurst - dt * TUNING.burst.genericDecay);
        this._armSplashBurst = Math.max(0, this._armSplashBurst - dt * TUNING.burst.armDecay);
        this._kickSplashBurst = Math.max(0, this._kickSplashBurst - dt * TUNING.burst.kickDecay);
        for (const emitter of this._particleEmitters) {
            emitter.cooldown = Math.max(0, emitter.cooldown - dt);
            emitter.keepAlive = Math.max(0, emitter.keepAlive - dt);
        }
    }

    reset() {
        this._splashBurst = 0;
        this._armSplashBurst = 0;
        this._kickSplashBurst = 0;
        this._kickParticleBurstPending = false;
        this._state = EMPTY_STATE;
        for (const emitter of this._particleEmitters) {
            this.clearParticleEmitter(emitter);
            if (this._particleEffectsEnabled) {
                emitter.node.active = true;
                emitter.system.play();
            }
        }
        this.update(0);
    }

    setVisible(active: boolean) {
        this.node.active = active;
    }

    setCulled(culled: boolean) {
        if (this._culled === culled) {
            return;
        }
        this._culled = culled;
        if (culled) {
            // Off-screen: stop simulating and clear residual particles/burst so nothing pops on return.
            // 离屏：停止模拟并清空残留粒子/爆发值，避免回到画面时突然爆水花。
            this._splashBurst = 0;
            this._armSplashBurst = 0;
            this._kickSplashBurst = 0;
            this._kickParticleBurstPending = false;
            for (const emitter of this._particleEmitters) {
                emitter.cooldown = 0;
                emitter.keepAlive = 0;
                emitter.sprayTime = 0;
                emitter.sprayRate = 0;
                emitter.sprayCarry = 0;
                emitter.system.clear();
            }
            if (this.node?.isValid) {
                this.node.active = false;
            }
        }
    }

    setParticleEffectsEnabled(enabled: boolean) {
        if (this._particleEffectsEnabled === enabled) {
            return;
        }
        this._particleEffectsEnabled = enabled;
        for (const emitter of this._particleEmitters) {
            this.clearParticleEmitter(emitter);
            emitter.node.active = enabled;
            if (enabled) {
                emitter.system.play();
            }
        }
    }

    setState(state: SplashEmitterState) {
        this._state = state;
    }

    setWaterY(waterY: number) {
        this._waterY = waterY;
    }

    update(speed: number) {
        if (!this.node || (this._parts.length === 0 && this._particleEmitters.length === 0)) {
            return;
        }
        if (this._culled) {
            if (this.node.active) {
                this.node.active = false;
            }
            return;
        }

        const speedRatio = clamp(speed / TUNING.speedNormalize, 0, 1);
        this._countSpeedFactor = this.computeCountSpeedFactor(speed);
        this.node.setPosition(this._options.owner.position.x, this._waterY, this._options.owner.position.z);
        // Yaw the whole splash rig to the swimmer's travel heading. The internal foam
        // and particle layout is built along the local lane axis (flipped by
        // movementDirection); rotating the root about Y aligns that local forward with
        // the actual world heading so splashes trail the body when it steers off-lane.
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        const yawDegrees = -direction * this._state.movementHeadingRadians * 180 / Math.PI;
        this.node.setRotationFromEuler(0, yawDegrees, 0);
        this.node.setScale(1, 1, 1);
        let anyActive = false;
        for (const part of this._parts) {
            const isHand = part.node.name.indexOf('Hand') >= 0;
            const isFoot = part.node.name.indexOf('Foot') >= 0;
            const isHandRipple = part.node.name.indexOf('HandRipple') >= 0;
            const handContact = this.handContactForPart(part.node.name);
            const handEntry = this.handEntryForPart(part.node.name);
            if (isHandRipple) {
                const enteredWater = handEntry > TUNING.foam.handContactThreshold
                    && part.lastHandEntry <= TUNING.foam.handContactThreshold;
                if (enteredWater) {
                    this.freezeHandRippleAtPalm(part);
                    part.rippleTime = TUNING.foam.handRippleLifetime;
                } else {
                    part.rippleTime = Math.max(0, part.rippleTime - this._lastDt);
                }
                part.lastHandEntry = handEntry;
                this.keepHandRippleFrozen(part);
            }
            const handSignal = isHandRipple
                ? clamp(part.rippleTime / TUNING.foam.handRippleLifetime, 0, 1)
                : handContact;
            const rawAction = isHand
                ? handSignal * (
                    speedRatio * part.speedWeight * TUNING.foam.handSpeedActionWeight
                    + this._state.armAction * part.armWeight
                    + this._splashBurst * part.burstWeight * TUNING.foam.handGenericBurstWeight
                    + this._armSplashBurst * part.armWeight * TUNING.foam.handArmBurstWeight
                )
                : speedRatio * part.speedWeight
                    + this._state.armAction * part.armWeight
                    + this._state.kickAction * part.kickWeight
                    + this._splashBurst * part.burstWeight * TUNING.foam.footGenericBurstWeight
                    + this._armSplashBurst * part.armWeight * TUNING.foam.footArmBurstWeight
                    + this._kickSplashBurst * part.kickWeight * TUNING.foam.footKickBurstWeight;
            const motionFloor = isFoot
                ? speedRatio * TUNING.foam.footSpeedMotionWeight + this._state.kickCycleMotion * TUNING.foam.footKickMotionWeight
                : isHand
                    ? handSignal * (speedRatio * TUNING.foam.handSpeedMotionWeight + this._state.armCycleMotion * TUNING.foam.handArmMotionWeight)
                    : speedRatio * TUNING.foam.otherSpeedMotionWeight;
            const action = Math.max(rawAction, motionFloor);
            const intensity = clamp(action, 0, TUNING.foam.maxIntensity);
            const burst = isHand
                ? handSignal * Math.max(
                    this._splashBurst * part.burstWeight * TUNING.foam.handBurstGenericWeight,
                    this._armSplashBurst * part.armWeight,
                    this._state.armCycleMotion * TUNING.foam.handArmCycleBurstWeight,
                )
                : Math.max(
                    this._splashBurst * part.burstWeight,
                    this._armSplashBurst * part.armWeight,
                    this._kickSplashBurst * part.kickWeight,
                );
            const active = isHandRipple
                ? part.rippleTime > 0
                : isHand
                ? handSignal > TUNING.foam.handContactThreshold
                    && (intensity > TUNING.foam.actionThreshold || burst > TUNING.foam.burstThreshold)
                : intensity > TUNING.foam.actionThreshold || burst > TUNING.foam.burstThreshold;
            part.node.active = active;
            anyActive = anyActive || active;

            const surge = Math.min(1, burst * TUNING.foam.surgeScaleX);
            const footBoost = isFoot ? TUNING.foam.footBoost : 1;
            if (!isHandRipple) {
                this.resolvePartPosition(part, speedRatio, surge, isFoot, isHand, handContact);
            }
            part.node.setRotationFromEuler(isHandRipple ? 0 : part.baseEuler.x, isHandRipple ? 0 : part.baseEuler.y, isHandRipple ? 0 : part.baseEuler.z);
            part.node.setScale(
                part.baseScale.x * footBoost * (1 + speedRatio * TUNING.foam.speedScaleX + surge * TUNING.foam.surgeScaleX),
                1,
                part.baseScale.z * footBoost * (1 + surge * TUNING.foam.surgeScaleZ),
            );
            part.params.set(intensity, speedRatio, Math.min(TUNING.foam.maxIntensity, burst), part.seed);
            part.material.setProperty('splashParams', part.params);
            if (isHandRipple) {
                part.shapeParams.w = 1 - clamp(part.rippleTime / TUNING.foam.handRippleLifetime, 0, 1);
                part.material.setProperty('shapeParams', part.shapeParams);
            }
        }
        if (this._particleEffectsEnabled) {
            this.updateParticleEmitters(speedRatio);
            for (const emitter of this._particleEmitters) {
                anyActive = anyActive || emitter.keepAlive > 0;
            }
        }
        this.node.active = anyActive;
    }

    // Map raw swim speed to an overall particle-count multiplier across the arm-cycle
    // speed window: minScale at/below armCycleSpeedStart, maxScale at/above armCycleSpeedFull.
    // This scales how many particles a burst emits without touching burst timing.
    // 将原始游泳速度映射为整体粒子数量倍率，覆盖手臂轮速的速度窗口：低于 armCycleSpeedStart 恒为
    // minScale，达到 armCycleSpeedFull 及以上恒为 maxScale。只缩放爆发的粒子数量，不改动爆发时机。
    private computeCountSpeedFactor(speed: number): number {
        const config = TUNING.speedCountScale;
        if (!config.enabled) {
            return 1;
        }
        const start = STROKE_QUALITY_TUNING.armCycleSpeedStart;
        const full = STROKE_QUALITY_TUNING.armCycleSpeedFull;
        const span = full - start;
        const t = span > 1e-4 ? clamp((speed - start) / span, 0, 1) : (speed >= full ? 1 : 0);
        return lerp(config.minScale, config.maxScale, t);
    }

    private createPart(
        sourceMaterial: Material,
        tuning: SplashFoamPartTuning,
    ) {
        const node = new Node(tuning.name);
        node.setParent(this.node);
        // The splash root may already have been moved to the dedicated swimmer
        // overlay layer before this async material callback completes. New Cocos
        // nodes default to DEFAULT rather than inheriting their parent's layer,
        // so copy it explicitly to avoid one-frame/camera-pass mismatches.
        node.layer = tuning.ripple ? WATER_SURFACE_LAYER : this.node.layer;
        const basePosition = toVec3(tuning.basePosition);
        const baseEuler = toVec3(tuning.baseEuler);
        const baseScale = toVec3(tuning.baseScale);
        node.setPosition(basePosition);
        node.setRotationFromEuler(baseEuler.x, baseEuler.y, baseEuler.z);
        node.setScale(baseScale);

        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = tuning.mesh === 'ripple'
            ? utils.createMesh(createEllipticalRippleGeometry(tuning.width, tuning.length))
            : utils.createMesh(primitives.plane({
                width: tuning.width,
                length: tuning.length,
                widthSegments: TUNING.foam.widthSegments,
                lengthSegments: TUNING.foam.lengthSegments,
            }));

        const runtimeMaterial = new Material();
        runtimeMaterial.copy(sourceMaterial);
        runtimeMaterial.name = `Runtime${tuning.name}`;
        runtimeMaterial.setProperty('shapeParams', new Vec4(tuning.flowStrength, tuning.trailStrength, tuning.ripple ? 1 : 0, 0));
        renderer.setMaterial(runtimeMaterial, 0);

        this._parts.push({
            node,
            material: runtimeMaterial,
            params: new Vec4(),
            shapeParams: new Vec4(tuning.flowStrength, tuning.trailStrength, tuning.ripple ? 1 : 0, 0),
            seed: Math.random() * TUNING.foamSeedRange,
            basePosition: basePosition.clone(),
            baseEuler: baseEuler.clone(),
            baseScale: baseScale.clone(),
            speedWeight: tuning.speedWeight,
            armWeight: tuning.armWeight,
            kickWeight: tuning.kickWeight,
            burstWeight: tuning.burstWeight,
            rippleTime: 0,
            lastHandEntry: 0,
            frozenWorldPosition: new Vec3(),
        });
    }

    private createParticleEmitterCluster(name: string, side: 'left' | 'right', sideZ: number) {
        const sideSign = side === 'left' ? -1 : 1;
        const cluster = this._reduced
            ? TUNING.particleEmitters.handCluster.slice(0, Math.max(1, TUNING.particleEmitters.reduced.handCount))
            : TUNING.particleEmitters.handCluster;
        for (const emitter of cluster) {
            this.createParticleEmitter(
                `${name}${emitter.nameSuffix}`,
                side,
                emitter,
                sideZ,
                sideSign,
            );
        }
    }

    private createLegParticleEmitter(name: string, side: 'left' | 'right', sideZ: number) {
        const sideSign = side === 'left' ? -1 : 1;
        const cluster = this._reduced
            ? TUNING.particleEmitters.legCluster.slice(0, Math.max(1, TUNING.particleEmitters.reduced.legCount))
            : TUNING.particleEmitters.legCluster;
        for (const emitter of cluster) {
            this.createParticleEmitter(
                `${name}${emitter.nameSuffix}`,
                side,
                emitter,
                sideZ,
                sideSign,
            );
        }
    }

    private createBodyParticleEmitter(name: string, side: 'left' | 'right', sideZ: number) {
        const sideSign = side === 'left' ? -1 : 1;
        this.createParticleEmitter(name, side, TUNING.particleEmitters.body, sideZ, sideSign);
    }

    private createParticleEmitter(name: string, side: 'left' | 'right', tuning: SplashParticleEmitterTuning, sideZ: number, sideSign: number) {
        const basePosition = emitterBaseVec3(tuning.basePosition, sideZ, sideSign * tuning.sideOffsetZ);
        const palmOffset = new Vec3(tuning.palmOffset[0], tuning.palmOffset[1], sideSign * tuning.palmOffset[2]);
        const lateralTilt = sideSign * tuning.lateralTilt;
        const node = new Node(name);
        node.setParent(this.node);
        node.layer = this.node.layer;
        node.setPosition(basePosition);
        node.setRotationFromEuler(TUNING.particleSystem.emitterEulerX, 0, 0);

        const system = node.addComponent(ParticleSystem);
        system.priority = TUNING.renderPriority;
        system.capacity = TUNING.particleSystem.capacity;
        system.loop = true;
        system.playOnAwake = false;
        system.duration = TUNING.particleSystem.duration;
        system.simulationSpace = TUNING.particleSystem.simulationSpace;
        system.simulationSpeed = TUNING.particleSystem.simulationSpeed;
        system.renderCulling = false;
        system.aabbHalfX = TUNING.particleSystem.aabbHalfX;
        system.aabbHalfY = TUNING.particleSystem.aabbHalfY;
        system.aabbHalfZ = TUNING.particleSystem.aabbHalfZ;
        setCurveRangeTwoConstants(system.startLifetime, TUNING.particleSystem.defaultLifetime[0], TUNING.particleSystem.defaultLifetime[1]);
        setCurveRangeTwoConstants(system.startSpeed, TUNING.particleSystem.defaultSpeed[0], TUNING.particleSystem.defaultSpeed[1]);
        setCurveRangeTwoConstants(system.startSizeX, TUNING.particleSystem.defaultSize[0], TUNING.particleSystem.defaultSize[1]);
        setCurveRangeTwoConstants(system.startSizeY, TUNING.particleSystem.defaultSize[0], TUNING.particleSystem.defaultSize[1]);
        setCurveRangeTwoConstants(system.startSizeZ, TUNING.particleSystem.defaultSize[0], TUNING.particleSystem.defaultSize[1]);
        setCurveRangeTwoConstants(system.startRotationZ, TUNING.particleSystem.startRotationZMin, TUNING.particleSystem.startRotationZMax);
        setCurveRange(system.startDelay, TUNING.particleSystem.startDelay);
        setCurveRange(system.gravityModifier, TUNING.particleSystem.handGravity);
        setCurveRange(system.rateOverTime, TUNING.particleSystem.rateOverTime);
        setCurveRange(system.rateOverDistance, TUNING.particleSystem.rateOverDistance);
        const alpha = tuning.visual === 'plume' ? TUNING.plumeAlpha : TUNING.particleAlpha;
        setGradientColor(system.startColor, new Color(255, 255, 255, alpha));
        setParticleFadeOut(system, tuning.role);
        setParticleSizeOverLifetime(system, tuning.role);
        const renderer = system.renderer as any;
        if (renderer) {
            renderer.useGPU = false;
            renderer.mainTexture = getSplashParticleTexture(tuning.visual);
            // Stretched billboard: each particle elongates along its velocity into a water streak.
            // This is what makes the spray read as flying water droplets instead of round bubbles.
            // 拉伸广告牌：每颗粒子沿速度方向拉长成水条。这正是让飞溅读作水滴而非圆泡泡的关键。
            // Blocky style uses a plain billboard (no stretch); squares are spun by random rotation.
            // 方块风格用普通广告牌（不拉伸）；方块靠随机旋转呈现。
            if (TUNING.style === 'blocky') {
                renderer.renderMode = TUNING.particleSystem.blockyRenderMode;
            } else {
                renderer.renderMode = TUNING.particleSystem.stretchedRenderMode;
                renderer.velocityScale = TUNING.particleSystem.stretchVelocityScale;
                renderer.lengthScale = TUNING.particleSystem.stretchLengthScale;
            }
        }
        const shape = system.shapeModule as any;
        if (shape) {
            shape.enable = true;
            shape.shapeType = TUNING.particleSystem.coneShapeType;
            shape.emitFrom = TUNING.particleSystem.emitFromBase;
            const useHandSprayProfile = tuning.role === 'leg' && tuning.visual === 'spray';
            const useLegShape = tuning.role === 'leg' && !useHandSprayProfile;
            shape.angle = useLegShape ? TUNING.particleSystem.legShapeAngle : TUNING.particleSystem.handShapeAngle;
            shape.radius = useLegShape ? TUNING.particleSystem.legShapeRadius : TUNING.particleSystem.handShapeRadius;
            shape.arc = TUNING.particleSystem.shapeArc;
            shape.randomDirectionAmount = useLegShape ? TUNING.particleSystem.legRandomDirection : TUNING.particleSystem.handRandomDirection;
            shape.randomPositionAmount = useLegShape ? TUNING.particleSystem.legRandomPosition : TUNING.particleSystem.handRandomPosition;
            shape.sphericalDirectionAmount = useLegShape ? TUNING.particleSystem.legSphericalDirection : TUNING.particleSystem.handSphericalDirection;
        }

        // Texture animation disabled for stretched droplets: a single soft droplet sprite is used.
        // 拉伸水滴模式下关闭序列帧：使用单张柔和水滴贴图。
        const texAnim = system.textureAnimationModule as any;
        if (texAnim) {
            texAnim.enable = false;
        }

        system.bursts = [];
        system.clear();
        if (this._particleEffectsEnabled) {
            system.play();
        } else {
            node.active = false;
        }
        applyParticleTexture(system, tuning.visual);

        this._particleEmitters.push({
            node,
            system,
            role: tuning.role,
            visual: tuning.visual,
            side,
            basePosition: basePosition.clone(),
            palmOffset: palmOffset.clone(),
            forwardTilt: tuning.forwardTilt,
            lateralTilt,
            countScale: tuning.countScale,
            sizeScale: tuning.sizeScale,
            heightScale: tuning.heightScale,
            sprayTime: 0,
            sprayRate: 0,
            sprayCarry: 0,
            lastContact: 0,
            cooldown: 0,
            keepAlive: 0,
        });
    }

    private updateParticleEmitters(speedRatio: number) {
        const kickParticleBurstPending = this._kickParticleBurstPending;
        for (const emitter of this._particleEmitters) {
            if (emitter.role === 'leg') {
                if (TUNING.particleEmitters.enableLeg) {
                    this.updateLegParticleEmitter(emitter, speedRatio, kickParticleBurstPending);
                } else {
                    this.clearParticleEmitter(emitter);
                }
                continue;
            }
            if (emitter.role === 'body') {
                if (TUNING.particleEmitters.enableBody) {
                    this.updateBodyParticleEmitter(emitter, speedRatio);
                } else {
                    this.clearParticleEmitter(emitter);
                }
                continue;
            }
            if (!TUNING.particleEmitters.enableHand) {
                this.clearParticleEmitter(emitter);
                continue;
            }

            const contact = emitter.side === 'left'
                ? this._state.leftHandWaterContact
                : this._state.rightHandWaterContact;
            const entry = emitter.side === 'left'
                ? this._state.leftHandWaterEntry
                : this._state.rightHandWaterEntry;
            const progress = emitter.side === 'left'
                ? this._state.leftHandWaterProgress
                : this._state.rightHandWaterProgress;
            const burst = Math.max(
                this._armSplashBurst * TUNING.behavior.handBurstArmWeight,
                this._splashBurst * TUNING.behavior.handBurstGenericWeight,
            );
            this.positionParticleEmitter(emitter, speedRatio, progress, Math.max(contact, entry));
            const enteringAtFullReach = entry > TUNING.behavior.handEntryThreshold
                && emitter.lastContact <= TUNING.behavior.handLastContactThreshold;
            if (enteringAtFullReach && emitter.cooldown <= 0) {
                const entryScale = lerp(TUNING.behavior.handEntryScaleMin, TUNING.behavior.handEntryScaleMax, clamp(entry, 0, 1));
                const count = Math.round((lerp(TUNING.behavior.handBurstCountMin, TUNING.behavior.handBurstCountMax, speedRatio)
                    + burst * TUNING.behavior.handBurstExtraCount) * entryScale);
                this.playParticleBurst(emitter, clamp(count, TUNING.behavior.handBurstCountClampMin, TUNING.behavior.handBurstCountClampMax), speedRatio, entryScale);
            }
            this.emitSprayFrame(emitter);
            emitter.lastContact = entry;
        }
        this._kickParticleBurstPending = false;
    }

    private updateLegParticleEmitter(emitter: SplashParticleEmitter, speedRatio: number, kickParticleBurstPending: boolean) {
        if (this._state.legSplashSuppressed) {
            emitter.lastContact = 0;
            emitter.sprayTime = 0;
            emitter.sprayRate = 0;
            emitter.sprayCarry = 0;
            return;
        }
        const kickSignal = clamp(
            speedRatio * TUNING.behavior.legSignalSpeedWeight
            + this._state.kickCycleMotion * TUNING.behavior.legSignalCycleWeight
            + this._state.kickAction * TUNING.behavior.legSignalActionWeight
            + this._kickSplashBurst * TUNING.behavior.legSignalBurstWeight,
            0,
            TUNING.behavior.legSignalMax,
        );
        this.positionParticleEmitter(emitter, speedRatio, 0, kickSignal);
        const entry = this.legEntryForEmitter(emitter);
        const entering = kickParticleBurstPending || (
            entry > TUNING.behavior.legEntryThreshold
            && emitter.lastContact <= TUNING.behavior.legLastEntryThreshold
        );
        if (entering) {
            const entryScale = lerp(TUNING.behavior.legEntryScaleMin, TUNING.behavior.legEntryScaleMax, clamp(entry, 0, 1));
            const strength = Math.max(kickSignal, entry);
            const count = Math.round(lerp(TUNING.behavior.legBurstCountMin, TUNING.behavior.legBurstCountMax, clamp(strength, 0, 1)));
            const useHandSprayProfile = emitter.visual === 'spray';
            this.playParticleBurst(
                emitter,
                count,
                useHandSprayProfile ? speedRatio : speedRatio * TUNING.behavior.legBurstSpeedScale,
                useHandSprayProfile ? entryScale : TUNING.behavior.legBurstPullScale * entryScale,
            );
        }
        this.emitSprayFrame(emitter);
        emitter.lastContact = entry;
    }

    private updateBodyParticleEmitter(emitter: SplashParticleEmitter, speedRatio: number) {
        // Torso foam that pulses with the arm stroke rhythm (not a continuous faucet).
        // 躯干泡沫，跟随手臂划水节奏脉冲（不是持续水龙头）。
        this.positionBodyParticleEmitter(emitter, speedRatio);
        const strokePulse = this._armSplashBurst;
        const risingEdge = emitter.lastContact <= TUNING.behavior.bodyPulseThreshold
            && strokePulse > TUNING.behavior.bodyPulseThreshold;
        if (risingEdge && speedRatio > TUNING.behavior.bodyEmitThreshold) {
            const strength = clamp(speedRatio + this._splashBurst * TUNING.behavior.bodySignalBurstWeight, 0, 1);
            const count = Math.round(lerp(TUNING.behavior.bodyBurstCountMin, TUNING.behavior.bodyBurstCountMax, strength));
            this.playParticleBurst(emitter, count, speedRatio * TUNING.behavior.bodyBurstSpeedScale, TUNING.behavior.bodyBurstPullScale);
        }
        this.emitSprayFrame(emitter);
        emitter.lastContact = strokePulse;
    }

    private clearParticleEmitter(emitter: SplashParticleEmitter) {
        emitter.lastContact = 0;
        emitter.cooldown = 0;
        emitter.keepAlive = 0;
        emitter.sprayTime = 0;
        emitter.sprayRate = 0;
        emitter.sprayCarry = 0;
        emitter.system.stop();
        emitter.system.clear();
    }

    private positionBodyParticleEmitter(emitter: SplashParticleEmitter, speedRatio: number) {
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        if (this._options.getBoneWorldPosition('Body', this._tmpWorld)) {
            this._tmpWorld.x += direction * (emitter.palmOffset.x - speedRatio * TUNING.behavior.bodySpeedBack);
            this._tmpWorld.y = this._waterY + emitter.palmOffset.y;
            this._tmpWorld.z += emitter.palmOffset.z;
            this.node.inverseTransformPoint(this._tmpLocal, this._tmpWorld);
            emitter.node.setPosition(this._tmpLocal);
        } else {
            emitter.node.setPosition(
                direction * (emitter.basePosition.x - speedRatio * TUNING.behavior.bodySpeedBack),
                emitter.basePosition.y,
                emitter.basePosition.z,
            );
        }
        emitter.node.setRotationFromEuler(TUNING.particleSystem.emitterEulerX, direction * emitter.forwardTilt, emitter.lateralTilt);
    }

    private positionParticleEmitter(emitter: SplashParticleEmitter, speedRatio: number, progress: number, contact: number) {
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        const boneName = emitter.role === 'leg'
            ? this.legSplashBoneName(emitter)
            : emitter.side === 'left' ? 'LeftHand' : 'RightHand';
        if (this._options.getBoneWorldPosition(boneName, this._tmpWorld)) {
            this._tmpWorld.x += direction * (emitter.palmOffset.x + speedRatio * TUNING.behavior.boneSpeedLead);
            if (emitter.role === 'leg') {
                this._tmpWorld.y = this._waterY + emitter.palmOffset.y;
            } else {
                this._tmpWorld.y = this._waterY + emitter.palmOffset.y;
            }
            this._tmpWorld.z += emitter.palmOffset.z;
            this.node.inverseTransformPoint(this._tmpLocal, this._tmpWorld);
            emitter.node.setPosition(this._tmpLocal);
            // All roles emit upward (cone along local -Z pitched up) so splash rises out of the water.
            // 所有角色都朝上发射（cone 本地 -Z 上仰），让水花冒出水面。
            emitter.node.setRotationFromEuler(TUNING.particleSystem.emitterEulerX, direction * emitter.forwardTilt, emitter.lateralTilt);
            return;
        }

        const frontCatchProgress = clamp(progress / TUNING.behavior.handProgressWindow, 0, 1);
        const forwardReach = lerp(TUNING.behavior.fallbackForwardReach, TUNING.behavior.fallbackBackReach, frontCatchProgress);
        const localForwardX = lerp(emitter.basePosition.x, forwardReach, clamp(contact, 0, 1));
        const speedLead = speedRatio * TUNING.behavior.fallbackSpeedLead;
        emitter.node.setPosition(
            direction * (localForwardX - speedLead),
            emitter.basePosition.y,
            emitter.basePosition.z,
        );
        emitter.node.setRotationFromEuler(TUNING.particleSystem.emitterEulerX, direction * emitter.forwardTilt, emitter.lateralTilt);
    }

    private playParticleBurst(emitter: SplashParticleEmitter, count: number, speedRatio: number, pullScale: number) {
        const isHand = emitter.role === 'hand';
        const isPlume = emitter.visual === 'plume';
        const useHandSprayProfile = emitter.role === 'leg' && emitter.visual === 'spray';
        const baseSpeed = !isHand && !useHandSprayProfile
            ? lerp(TUNING.behavior.legSpeedMin, TUNING.behavior.legSpeedMax, speedRatio) * pullScale
            : lerp(TUNING.behavior.handSpeedMin, TUNING.behavior.handSpeedMax, speedRatio) * pullScale;
        const speed = baseSpeed * (isPlume ? TUNING.behavior.plumeSpeedScale : 1);
        setCurveRangeTwoConstants(emitter.system.startSpeed, speed * TUNING.behavior.speedRangeMinScale, speed * TUNING.behavior.speedRangeMaxScale);
        const lifetimeScale = isPlume ? TUNING.behavior.plumeLifetimeScale : 1;
        setCurveRangeTwoConstants(
            emitter.system.startLifetime,
            this.particleLifetimeMin(emitter) * lifetimeScale,
            this.particleLifetimeMax(emitter, speedRatio) * lifetimeScale,
        );
        setCurveRange(
            emitter.system.gravityModifier,
            isPlume ? TUNING.behavior.plumeGravity : !isHand && !useHandSprayProfile ? TUNING.particleSystem.legGravity : TUNING.particleSystem.handGravity,
        );
        const styleSizeScale = TUNING.style === 'blocky' ? TUNING.blockyTexture.sizeMultiplier : 1;
        const size = (!isHand && !useHandSprayProfile
            ? lerp(TUNING.behavior.legSizeMin, TUNING.behavior.legSizeMax, speedRatio)
            : lerp(TUNING.behavior.handSizeMin, TUNING.behavior.handSizeMax, speedRatio)) * styleSizeScale;
        const width = size * emitter.sizeScale;
        const height = width * emitter.heightScale;
        setCurveRangeTwoConstants(emitter.system.startSizeX, width * TUNING.behavior.sizeRangeMinScale, width * TUNING.behavior.sizeRangeMaxScale);
        setCurveRangeTwoConstants(emitter.system.startSizeY, height * TUNING.behavior.sizeRangeMinScale, height * TUNING.behavior.sizeRangeMaxScale);
        setCurveRangeTwoConstants(emitter.system.startSizeZ, width * TUNING.behavior.sizeRangeMinScale, width * TUNING.behavior.sizeRangeMaxScale);
        this.node.active = true;
        emitter.system.play();
        applyParticleTexture(emitter.system, emitter.visual);
        const scaledCount = Math.max(TUNING.behavior.minimumScaledCount, Math.round(count * emitter.countScale * this._countSpeedFactor));
        const spraySeconds = !isHand && !useHandSprayProfile ? TUNING.behavior.legSpraySeconds : TUNING.behavior.handSpraySeconds;
        this.emitJitteredParticles(
            emitter,
            Math.max(
                !isHand && !useHandSprayProfile ? TUNING.behavior.legInitialEmitMin : TUNING.behavior.handInitialEmitMin,
                Math.round(scaledCount * TUNING.behavior.initialEmitScale),
            ),
            0,
        );
        emitter.sprayTime = spraySeconds;
        emitter.sprayRate = scaledCount / spraySeconds;
        emitter.sprayCarry = 0;
        emitter.cooldown = lerp(TUNING.behavior.burstCooldownMax, TUNING.behavior.burstCooldownMin, speedRatio);
        emitter.keepAlive = lerp(TUNING.behavior.keepAliveMin, TUNING.behavior.keepAliveMax, speedRatio);
    }

    private particleLifetimeMin(emitter: SplashParticleEmitter): number {
        const base = emitter.role === 'leg' && emitter.visual !== 'spray' ? TUNING.behavior.legLifetimeMin : TUNING.behavior.handLifetimeMin;
        return Math.min(base, this.particleLifetimeCap(emitter));
    }

    private particleLifetimeMax(emitter: SplashParticleEmitter, speedRatio: number): number {
        const base = emitter.role === 'leg' && emitter.visual !== 'spray'
            ? lerp(TUNING.behavior.legLifetimeMaxLowSpeed, TUNING.behavior.legLifetimeMaxHighSpeed, speedRatio)
            : lerp(TUNING.behavior.handLifetimeMaxLowSpeed, TUNING.behavior.handLifetimeMaxHighSpeed, speedRatio);
        return Math.min(base, this.particleLifetimeCap(emitter));
    }

    private particleLifetimeCap(emitter: SplashParticleEmitter): number {
        return TUNING.particleSystem.roleWaterlineLifetimeCap[emitter.role] ?? TUNING.particleSystem.waterlineLifetimeCap;
    }

    private emitSprayFrame(emitter: SplashParticleEmitter) {
        if (emitter.sprayTime <= 0 || emitter.sprayRate <= 0) {
            return;
        }

        const dt = clamp(this._lastDt, TUNING.behavior.minSprayDt, TUNING.behavior.maxSprayDt);
        emitter.sprayTime = Math.max(0, emitter.sprayTime - dt);
        emitter.sprayCarry += emitter.sprayRate * dt;
        const emitCount = Math.floor(emitter.sprayCarry);
        if (emitCount <= 0) {
            return;
        }

        emitter.sprayCarry -= emitCount;
        emitter.system.play();
        applyParticleTexture(emitter.system, emitter.visual);
        this.emitJitteredParticles(emitter, emitCount, dt);
    }

    private emitJitteredParticles(emitter: SplashParticleEmitter, count: number, dt: number) {
        const basePosition = this._tmpEmitPosition.set(emitter.node.position);
        const baseEuler = this._tmpEmitEuler.set(emitter.node.eulerAngles);
        const isHand = emitter.role === 'hand' || emitter.visual === 'spray';
        const positionJitterX = !isHand ? TUNING.behavior.legJitterX : TUNING.behavior.handJitterX;
        const positionJitterY = !isHand ? TUNING.behavior.legJitterY : TUNING.behavior.handJitterY;
        const positionJitterZ = !isHand ? TUNING.behavior.legJitterZ : TUNING.behavior.handJitterZ;
        const rotationJitterX = !isHand ? TUNING.behavior.legRotationJitterX : TUNING.behavior.handRotationJitterX;
        const rotationJitterY = !isHand ? TUNING.behavior.legRotationJitterY : TUNING.behavior.handRotationJitterY;
        const rotationJitterZ = !isHand ? TUNING.behavior.legRotationJitterZ : TUNING.behavior.handRotationJitterZ;
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        for (let i = 0; i < count; i++) {
            const forwardSplash = emitter.role === 'hand' && Math.random() < TUNING.behavior.forwardSplashChance;
            const forwardOffset = forwardSplash
                ? direction * randomRange(TUNING.behavior.forwardOffsetMin, TUNING.behavior.forwardOffsetMax)
                : 0;
            const forwardTurn = forwardSplash
                ? direction * randomRange(TUNING.behavior.forwardTurnMin, TUNING.behavior.forwardTurnMax)
                : 0;
            emitter.node.setPosition(
                basePosition.x + randomRange(-positionJitterX, positionJitterX) + forwardOffset,
                basePosition.y + randomRange(TUNING.behavior.baseJitterYDown, positionJitterY),
                basePosition.z + randomRange(-positionJitterZ, positionJitterZ),
            );
            emitter.node.setRotationFromEuler(
                baseEuler.x + randomRange(-rotationJitterX, rotationJitterX),
                baseEuler.y + forwardTurn + randomRange(-rotationJitterY, rotationJitterY),
                baseEuler.z + randomRange(-rotationJitterZ, rotationJitterZ),
            );
            (emitter.system as any).emit(1, dt);
        }
        emitter.node.setPosition(basePosition);
        emitter.node.setRotationFromEuler(baseEuler.x, baseEuler.y, baseEuler.z);
    }

    private legSplashBoneName(emitter: SplashParticleEmitter): string {
        return emitter.side === 'left' ? 'LeftFoot' : 'RightFoot';
    }

    private legEntryForEmitter(emitter: SplashParticleEmitter): number {
        const oppositeHandEntry = emitter.side === 'left' ? this._state.rightHandWaterEntry : this._state.leftHandWaterEntry;
        return Math.max(oppositeHandEntry, this._kickSplashBurst);
    }

    private handContactForPart(name: string): number {
        if (name.indexOf('LeftHand') >= 0) {
            return this._state.leftHandWaterContact;
        }
        if (name.indexOf('RightHand') >= 0) {
            return this._state.rightHandWaterContact;
        }
        return 0;
    }

    private handProgressForPart(name: string): number {
        if (name.indexOf('LeftHand') >= 0) {
            return this._state.leftHandWaterProgress;
        }
        if (name.indexOf('RightHand') >= 0) {
            return this._state.rightHandWaterProgress;
        }
        return 0;
    }

    private handEntryForPart(name: string): number {
        if (name.indexOf('LeftHand') >= 0) {
            return this._state.leftHandWaterEntry;
        }
        if (name.indexOf('RightHand') >= 0) {
            return this._state.rightHandWaterEntry;
        }
        return 0;
    }

    private resolvePartPosition(part: SplashPart, speedRatio: number, surge: number, isFoot: boolean, isHand: boolean, handContact: number) {
        if (isHand) {
            this.resolveHandPartPosition(part, speedRatio, surge, handContact);
            return;
        }

        const hasBonePosition = this._options.getBoneWorldPosition(part.node.name, this._tmpWorld);
        if (hasBonePosition) {
            this._tmpWorld.y = this._waterY + part.basePosition.y + surge * TUNING.foam.surgeYOffset;
            this._tmpWorld.x -= speedRatio * (isFoot ? TUNING.foam.footBoneSpeedBack : TUNING.foam.bodySpeedBack);
            this.node.inverseTransformPoint(this._tmpLocal, this._tmpWorld);
            part.node.setPosition(this._tmpLocal);
            return;
        }

        part.node.setPosition(
            part.basePosition.x - speedRatio * TUNING.foam.fallbackBaseSpeedBack + (isFoot ? -speedRatio * TUNING.foam.fallbackFootExtraBack : 0),
            part.basePosition.y + surge * TUNING.foam.surgeYOffset,
            part.basePosition.z,
        );
    }

    private resolveHandPartPosition(part: SplashPart, speedRatio: number, surge: number, handContact: number) {
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        const progress = this.handProgressForPart(part.node.name);
        const strokeX = lerp(TUNING.foam.handStrokeXFront, TUNING.foam.handStrokeXBack, progress);
        const baseX = lerp(part.basePosition.x, strokeX, handContact) - speedRatio * TUNING.foam.handSpeedBack;
        const baseY = part.basePosition.y + surge * TUNING.foam.surgeYOffset;
        const baseZ = part.basePosition.z;
        part.node.setPosition(direction * baseX, baseY, baseZ);
    }

    private freezeHandRippleAtPalm(part: SplashPart) {
        const boneName = part.node.name.indexOf('Left') >= 0 ? 'LeftHand' : 'RightHand';
        if (this._options.getBoneWorldPosition(boneName, this._tmpWorld)) {
            this._tmpWorld.y = this._waterY + part.basePosition.y;
            part.frozenWorldPosition.set(this._tmpWorld);
            this.keepHandRippleFrozen(part);
            return;
        }
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        this._tmpLocal.set(direction * part.basePosition.x, part.basePosition.y, part.basePosition.z);
        Vec3.transformMat4(part.frozenWorldPosition, this._tmpLocal, this.node.worldMatrix);
        this.keepHandRippleFrozen(part);
    }

    private keepHandRippleFrozen(part: SplashPart) {
        // Ripple nodes remain under the moving splash root, so transform the saved
        // water-entry point back to local space every frame to cancel parent motion.
        this.node.inverseTransformPoint(this._tmpLocal, part.frozenWorldPosition);
        part.node.setPosition(this._tmpLocal);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function toVec3(value: SplashVec3): Vec3 {
    return new Vec3(value[0], value[1], value[2]);
}

function emitterBaseVec3(value: SplashVec3, baseZ: number, mirrorZOffset: number): Vec3 {
    return new Vec3(value[0], value[1], baseZ + value[2] + mirrorZOffset);
}

function createEllipticalRippleGeometry(width: number, length: number) {
    const segments = 12;
    const positions = [0, 0, 0];
    const normals = [0, 1, 0];
    const uvs = [0.5, 0.5];
    const indices: number[] = [];
    const radiusX = width * 0.5;
    const radiusZ = length * 0.5;
    for (let index = 0; index < segments; index++) {
        const angle = index / segments * Math.PI * 2;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        positions.push(cosine * radiusX, 0, sine * radiusZ);
        normals.push(0, 1, 0);
        uvs.push(0.5 + cosine * 0.5, 0.5 + sine * 0.5);
    }
    for (let index = 0; index < segments; index++) {
        indices.push(0, index + 1, (index + 1) % segments + 1);
    }
    return { positions, normals, uvs, indices };
}

function setCurveRange(range: CurveRange, value: number) {
    if (!range) {
        return;
    }
    range.mode = CurveRange.Mode.Constant;
    range.constant = value;
}

function setCurveRangeTwoConstants(range: CurveRange, min: number, max: number) {
    if (!range) {
        return;
    }
    range.mode = CurveRange.Mode.TwoConstants;
    range.constantMin = min;
    range.constantMax = max;
}

// Linear 0->1 curve, used to drive flipbook frameOverTime across a particle's lifetime.
// 线性 0->1 曲线，用于驱动序列帧 frameOverTime 贯穿粒子生命周期。
function setCurveRangeLinear01(range: CurveRange) {
    if (!range) {
        return;
    }
    const curve = new RealCurve();
    curve.assignSorted([[0, 0], [1, 1]]);
    range.mode = CurveRange.Mode.Curve;
    range.spline = curve;
    range.multiplier = 1;
}

function setGradientColor(range: GradientRange, color: Color) {
    if (!range) {
        return;
    }
    range.mode = GradientRange.Mode.Color;
    range.color = color;
}

function setParticleFadeOut(system: ParticleSystem, role: SplashParticleEmitterTuning['role']) {
    const module = system.colorOverLifetimeModule;
    if (!module?.color) {
        return;
    }
    const fade = TUNING.particleSystem.roleFade[role];

    const startColor = new ColorKey();
    startColor.color = new Color(255, 255, 255, 255);
    startColor.time = 0;
    const endColor = new ColorKey();
    endColor.color = new Color(255, 255, 255, 255);
    endColor.time = 1;
    const startAlpha = new AlphaKey();
    startAlpha.alpha = 1;
    startAlpha.time = 0;
    const holdAlpha = new AlphaKey();
    holdAlpha.alpha = TUNING.particleSystem.fadeHoldAlpha;
    holdAlpha.time = fade?.holdTime ?? TUNING.particleSystem.fadeHoldTime;
    const endAlpha = new AlphaKey();
    endAlpha.alpha = TUNING.particleSystem.fadeEndAlpha;
    endAlpha.time = fade?.endTime ?? TUNING.particleSystem.fadeEndTime;
    const invisibleAlpha = new AlphaKey();
    invisibleAlpha.alpha = TUNING.particleSystem.fadeEndAlpha;
    invisibleAlpha.time = 1;
    const gradient = new Gradient();
    gradient.setKeys([startColor, endColor], [startAlpha, holdAlpha, endAlpha, invisibleAlpha]);

    module.enable = true;
    module.color.mode = GradientRange.Mode.Gradient;
    module.color.gradient = gradient;
}

function setParticleSizeOverLifetime(system: ParticleSystem, role: SplashParticleEmitterTuning['role']) {
    const module = system.sizeOvertimeModule;
    if (!module?.size) {
        return;
    }

    const curve = new RealCurve();
    const samples: ReadonlyArray<readonly [number, number]> = TUNING.particleSystem.roleSizeOverLifetime[role] ?? TUNING.particleSystem.sizeOverLifetime;
    curve.assignSorted(samples.map(([time, value]) => [time, value]));

    module.enable = true;
    module.separateAxes = false;
    module.size.mode = CurveRange.Mode.Curve;
    module.size.spline = curve;
    module.size.multiplier = 1;
}

function getSplashParticleTexture(visual: SplashParticleEmitterTuning['visual']): Texture2D {
    const texture = visual === 'plume' ? _splashParticleTexture : _splashSprayTexture;
    if (!texture) {
        throw new Error(`Swimmer ${visual} particle texture has not loaded.`);
    }
    return texture;
}

function applyParticleTexture(system: ParticleSystem, visual: SplashParticleEmitterTuning['visual']) {
    const texture = getSplashParticleTexture(visual);
    const particleMaterial = getSplashParticleMaterial(texture, visual);
    system.priority = TUNING.renderPriority;
    const renderer = system.renderer as any;
    if (renderer) {
        renderer.cpuMaterial = particleMaterial;
        renderer.mainTexture = texture;
        if (TUNING.style === 'blocky' || visual === 'plume') {
            renderer.renderMode = TUNING.particleSystem.blockyRenderMode;
        } else {
            renderer.renderMode = TUNING.particleSystem.stretchedRenderMode;
            renderer.velocityScale = TUNING.particleSystem.stretchVelocityScale;
            renderer.lengthScale = TUNING.particleSystem.stretchLengthScale;
        }
        // Cocos only copies renderer.mainTexture while constructing its default CPU
        // material. The renderer's particle-material setter updates the active pass.
        system.processor?.updateMaterialParams();
    }
}

function getSplashParticleMaterial(texture: Texture2D, visual: SplashParticleEmitterTuning['visual']): Material {
    let particleMaterial = _splashParticleMaterials[visual];
    if (!particleMaterial || !particleMaterial.isValid) {
        const defaultParticleMaterial = builtinResMgr.get<Material>('default-particle-material');
        if (!defaultParticleMaterial) {
            throw new Error('Cocos default particle material is unavailable.');
        }
        particleMaterial = new Material();
        particleMaterial.copy(defaultParticleMaterial);
        particleMaterial.name = `RuntimeSwimmer${visual === 'plume' ? 'Plume' : 'Spray'}Particle`;
        _splashParticleMaterials[visual] = particleMaterial;
    }
    particleMaterial.setProperty('mainTexture', texture);
    return particleMaterial;
}

function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}
