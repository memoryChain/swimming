import { AlphaKey, Color, ColorKey, CurveRange, Gradient, GradientRange, Material, MeshRenderer, Node, ParticleSystem, primitives, RealCurve, resources, Texture2D, utils, Vec3, Vec4 } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';
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
};

type SplashParticleEmitter = {
    node: Node;
    system: ParticleSystem;
    role: 'hand' | 'leg';
    side: 'left' | 'right';
    basePosition: Vec3;
    palmOffset: Vec3;
    forwardTilt: number;
    lateralTilt: number;
    countScale: number;
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
};

const EMPTY_STATE: SplashEmitterState = {
    armAction: 0,
    kickAction: 0,
    armCycleMotion: 0,
    kickCycleMotion: 0,
    movementDirection: 1,
    leftHandWaterContact: 0,
    rightHandWaterContact: 0,
    leftHandWaterEntry: 0,
    rightHandWaterEntry: 0,
    leftHandWaterProgress: 0,
    rightHandWaterProgress: 0,
};

let _splashParticleTexture: Texture2D | null = null;
const TUNING = SPLASH_EMITTER_TUNING;

export class SplashEmitter {
    public readonly node: Node;

    private readonly _parts: SplashPart[] = [];
    private readonly _particleEmitters: SplashParticleEmitter[] = [];
    private readonly _tmpWorld = new Vec3();
    private readonly _tmpEmitterWorld = new Vec3();
    private readonly _tmpLocal = new Vec3();
    private _state: SplashEmitterState = EMPTY_STATE;
    private _splashBurst = 0;
    private _armSplashBurst = 0;
    private _kickSplashBurst = 0;
    private _lastDt = TUNING.initialDt;
    private _waterY: number;

    constructor(private readonly _options: SplashEmitterOptions) {
        this._waterY = _options.waterY;
        this.node = new Node(_options.name);
        this.node.setParent(_options.parent);
        this.node.setPosition(_options.owner.position.x, this._waterY, _options.owner.position.z);
        this.node.setScale(1, 1, 1);
        this.node.active = true;
    }

    build() {
        resources.load(RESOURCE_PATHS.swimmerSplashMaterial, Material, (err, material) => {
            if (err || !material || !this.node?.isValid) {
                console.warn('[SpeedSwimming] failed to load swimmer splash material', err);
                return;
            }
            this._parts.length = 0;
            for (const part of TUNING.foam.parts) {
                this.createPart(material, part);
            }
            this.createParticleEmitterCluster('LeftHandSplashParticles', 'left', TUNING.particleEmitters.leftHandZ);
            this.createParticleEmitterCluster('RightHandSplashParticles', 'right', TUNING.particleEmitters.rightHandZ);
            this.createLegParticleEmitter('LeftLowerLegSplashParticles', 'left', TUNING.particleEmitters.leftLegZ);
            this.createLegParticleEmitter('RightLowerLegSplashParticles', 'right', TUNING.particleEmitters.rightLegZ);
            this.update(0);
        });
    }

    triggerArmStroke() {
        this._armSplashBurst = Math.max(this._armSplashBurst, TUNING.burst.armStroke);
        this._splashBurst = Math.max(this._splashBurst, TUNING.burst.armGeneric);
    }

    triggerKick() {
        this._kickSplashBurst = Math.max(this._kickSplashBurst, TUNING.burst.kick);
        this._splashBurst = Math.max(this._splashBurst, TUNING.burst.kickGeneric);
    }

    triggerBurst(scale = 1) {
        const safeScale = Math.max(0, scale);
        this._splashBurst = Math.max(this._splashBurst, safeScale);
        this._armSplashBurst = Math.max(this._armSplashBurst, safeScale * TUNING.burst.armScale);
        this._kickSplashBurst = Math.max(this._kickSplashBurst, safeScale * TUNING.burst.kickScale);
        this.update(TUNING.triggerBurstUpdateSpeed);
    }

    decay(dt: number) {
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
        this._state = EMPTY_STATE;
        for (const emitter of this._particleEmitters) {
            emitter.lastContact = 0;
            emitter.cooldown = 0;
            emitter.keepAlive = 0;
            emitter.sprayTime = 0;
            emitter.sprayRate = 0;
            emitter.sprayCarry = 0;
            emitter.system.clear();
            emitter.system.play();
        }
        this.update(0);
    }

    setVisible(active: boolean) {
        this.node.active = active;
    }

    setState(state: SplashEmitterState) {
        this._state = state;
    }

    setWaterY(waterY: number) {
        this._waterY = waterY;
    }

    update(speed: number) {
        if (!this.node || this._parts.length === 0) {
            return;
        }

        const speedRatio = clamp(speed / TUNING.speedNormalize, 0, 1);
        this.node.setPosition(this._options.owner.position.x, this._waterY, this._options.owner.position.z);
        this.node.setRotationFromEuler(0, 0, 0);
        this.node.setScale(1, 1, 1);
        let anyActive = false;
        for (const part of this._parts) {
            const isHand = part.node.name.indexOf('Hand') >= 0;
            const isFoot = part.node.name.indexOf('Foot') >= 0;
            const handContact = this.handContactForPart(part.node.name);
            const rawAction = isHand
                ? handContact * (
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
                    ? handContact * (speedRatio * TUNING.foam.handSpeedMotionWeight + this._state.armCycleMotion * TUNING.foam.handArmMotionWeight)
                    : speedRatio * TUNING.foam.otherSpeedMotionWeight;
            const action = Math.max(rawAction, motionFloor);
            const intensity = clamp(action, 0, TUNING.foam.maxIntensity);
            const burst = isHand
                ? handContact * Math.max(
                    this._splashBurst * part.burstWeight * TUNING.foam.handBurstGenericWeight,
                    this._armSplashBurst * part.armWeight,
                    this._state.armCycleMotion * TUNING.foam.handArmCycleBurstWeight,
                )
                : Math.max(
                    this._splashBurst * part.burstWeight,
                    this._armSplashBurst * part.armWeight,
                    this._kickSplashBurst * part.kickWeight,
                );
            const active = isHand
                ? handContact > TUNING.foam.handContactThreshold
                    && (intensity > TUNING.foam.actionThreshold || burst > TUNING.foam.burstThreshold)
                : intensity > TUNING.foam.actionThreshold || burst > TUNING.foam.burstThreshold;
            part.node.active = active;
            anyActive = anyActive || active;

            const surge = Math.min(1, burst * TUNING.foam.surgeScaleX);
            const footBoost = isFoot ? TUNING.foam.footBoost : 1;
            this.resolvePartPosition(part, speedRatio, surge, isFoot, isHand, handContact);
            part.node.setRotationFromEuler(part.baseEuler.x, part.baseEuler.y, part.baseEuler.z);
            part.node.setScale(
                part.baseScale.x * footBoost * (1 + speedRatio * TUNING.foam.speedScaleX + surge * TUNING.foam.surgeScaleX),
                1,
                part.baseScale.z * footBoost * (1 + surge * TUNING.foam.surgeScaleZ),
            );
            part.params.set(intensity, speedRatio, Math.min(TUNING.foam.maxIntensity, burst), part.seed);
            part.material.setProperty('splashParams', part.params);
        }
        this.updateParticleEmitters(speedRatio);
        for (const emitter of this._particleEmitters) {
            anyActive = anyActive || emitter.keepAlive > 0;
        }
        this.node.active = anyActive;
    }

    private createPart(
        sourceMaterial: Material,
        tuning: SplashFoamPartTuning,
    ) {
        const node = new Node(tuning.name);
        node.setParent(this.node);
        const basePosition = toVec3(tuning.basePosition);
        const baseEuler = toVec3(tuning.baseEuler);
        const baseScale = toVec3(tuning.baseScale);
        node.setPosition(basePosition);
        node.setRotationFromEuler(baseEuler.x, baseEuler.y, baseEuler.z);
        node.setScale(baseScale);

        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.plane({
            width: tuning.width,
            length: tuning.length,
            widthSegments: TUNING.foam.widthSegments,
            lengthSegments: TUNING.foam.lengthSegments,
        }));

        const runtimeMaterial = new Material();
        runtimeMaterial.copy(sourceMaterial);
        runtimeMaterial.name = `Runtime${tuning.name}`;
        runtimeMaterial.setProperty('shapeParams', new Vec4(tuning.flowStrength, tuning.trailStrength, 0, 0));
        renderer.setMaterial(runtimeMaterial, 0);

        this._parts.push({
            node,
            material: runtimeMaterial,
            params: new Vec4(),
            shapeParams: new Vec4(tuning.flowStrength, tuning.trailStrength, 0, 0),
            seed: Math.random() * TUNING.foamSeedRange,
            basePosition: basePosition.clone(),
            baseEuler: baseEuler.clone(),
            baseScale: baseScale.clone(),
            speedWeight: tuning.speedWeight,
            armWeight: tuning.armWeight,
            kickWeight: tuning.kickWeight,
            burstWeight: tuning.burstWeight,
        });
    }

    private createParticleEmitterCluster(name: string, side: 'left' | 'right', sideZ: number) {
        const sideSign = side === 'left' ? -1 : 1;
        for (const emitter of TUNING.particleEmitters.handCluster) {
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
        this.createParticleEmitter(name, side, TUNING.particleEmitters.leg, sideZ, sideSign);
    }

    private createParticleEmitter(name: string, side: 'left' | 'right', tuning: SplashParticleEmitterTuning, sideZ: number, sideSign: number) {
        const basePosition = emitterBaseVec3(tuning.basePosition, sideZ, sideSign * tuning.sideOffsetZ);
        const palmOffset = new Vec3(tuning.palmOffset[0], tuning.palmOffset[1], sideSign * tuning.palmOffset[2]);
        const lateralTilt = sideSign * tuning.lateralTilt;
        const node = new Node(name);
        node.setParent(this.node);
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
        setCurveRange(system.startRotationZ, TUNING.particleSystem.startRotationZ);
        setCurveRange(system.startDelay, TUNING.particleSystem.startDelay);
        setCurveRange(system.gravityModifier, TUNING.particleSystem.handGravity);
        setCurveRange(system.rateOverTime, TUNING.particleSystem.rateOverTime);
        setCurveRange(system.rateOverDistance, TUNING.particleSystem.rateOverDistance);
        setGradientColor(system.startColor, new Color(255, 255, 255, TUNING.particleAlpha));
        setParticleFadeOut(system);
        setParticleSizeOverLifetime(system);
        const renderer = system.renderer as any;
        if (renderer) {
            renderer.useGPU = false;
            renderer.particleMaterial = null;
            renderer.cpuMaterial = null;
            renderer.mainTexture = getSplashParticleTexture();
        }
        system.setSharedMaterial(null, 0);

        const shape = system.shapeModule as any;
        if (shape) {
            shape.enable = true;
            shape.shapeType = TUNING.particleSystem.coneShapeType;
            shape.emitFrom = TUNING.particleSystem.emitFromBase;
            shape.angle = tuning.role === 'leg' ? TUNING.particleSystem.legShapeAngle : TUNING.particleSystem.handShapeAngle;
            shape.radius = tuning.role === 'leg' ? TUNING.particleSystem.legShapeRadius : TUNING.particleSystem.handShapeRadius;
            shape.arc = TUNING.particleSystem.shapeArc;
            shape.randomDirectionAmount = tuning.role === 'leg' ? TUNING.particleSystem.legRandomDirection : TUNING.particleSystem.handRandomDirection;
            shape.randomPositionAmount = tuning.role === 'leg' ? TUNING.particleSystem.legRandomPosition : TUNING.particleSystem.handRandomPosition;
            shape.sphericalDirectionAmount = tuning.role === 'leg' ? TUNING.particleSystem.legSphericalDirection : TUNING.particleSystem.handSphericalDirection;
        }

        system.bursts = [];
        system.clear();
        system.play();
        applyParticleTexture(system);

        this._particleEmitters.push({
            node,
            system,
            role: tuning.role,
            side,
            basePosition: basePosition.clone(),
            palmOffset: palmOffset.clone(),
            forwardTilt: tuning.forwardTilt,
            lateralTilt,
            countScale: tuning.countScale,
            sprayTime: 0,
            sprayRate: 0,
            sprayCarry: 0,
            lastContact: 0,
            cooldown: 0,
            keepAlive: 0,
        });
    }

    private updateParticleEmitters(speedRatio: number) {
        for (const emitter of this._particleEmitters) {
            if (emitter.role === 'leg') {
                this.updateLegParticleEmitter(emitter, speedRatio);
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
    }

    private updateLegParticleEmitter(emitter: SplashParticleEmitter, speedRatio: number) {
        const waterContact = this.legSurfaceContact(emitter);
        if (waterContact <= TUNING.behavior.legSurfaceContactThreshold) {
            emitter.lastContact = 0;
            emitter.sprayTime = 0;
            emitter.sprayRate = 0;
            emitter.sprayCarry = 0;
            emitter.system.clear();
            return;
        }
        const kickSignal = clamp(
            (
                speedRatio * TUNING.behavior.legSignalSpeedWeight
                + this._state.kickCycleMotion * TUNING.behavior.legSignalCycleWeight
                + this._state.kickAction * TUNING.behavior.legSignalActionWeight
                + this._kickSplashBurst * TUNING.behavior.legSignalBurstWeight
            ) * waterContact,
            0,
            TUNING.behavior.legSignalMax,
        );
        this.positionParticleEmitter(emitter, speedRatio, 0, kickSignal);
        if (kickSignal > TUNING.behavior.legEmitThreshold && emitter.cooldown <= 0) {
            const count = Math.round(lerp(TUNING.behavior.legBurstCountMin, TUNING.behavior.legBurstCountMax, clamp(kickSignal, 0, 1)));
            this.playParticleBurst(emitter, count, speedRatio * TUNING.behavior.legBurstSpeedScale, TUNING.behavior.legBurstPullScale);
            emitter.cooldown = lerp(TUNING.behavior.legCooldownMax, TUNING.behavior.legCooldownMin, clamp(kickSignal, 0, 1));
        }
        this.emitSprayFrame(emitter);
        emitter.lastContact = kickSignal;
    }

    private positionParticleEmitter(emitter: SplashParticleEmitter, speedRatio: number, progress: number, contact: number) {
        const direction = this._state.movementDirection >= 0 ? 1 : -1;
        const boneName = emitter.role === 'leg'
            ? emitter.side === 'left' ? 'LeftLeg' : 'RightLeg'
            : emitter.side === 'left' ? 'LeftHand' : 'RightHand';
        if (this._options.getBoneWorldPosition(boneName, this._tmpWorld)) {
            this._tmpWorld.x += direction * (emitter.palmOffset.x + speedRatio * TUNING.behavior.boneSpeedLead);
            if (emitter.role === 'leg') {
                this._tmpWorld.y = lerp(this._tmpWorld.y, this._waterY + emitter.palmOffset.y, this.legSurfaceContact(emitter) * TUNING.behavior.legSurfaceYBlend);
            } else {
                this._tmpWorld.y = this._waterY + emitter.palmOffset.y;
            }
            this._tmpWorld.z += emitter.palmOffset.z;
            this.node.inverseTransformPoint(this._tmpLocal, this._tmpWorld);
            emitter.node.setPosition(this._tmpLocal);
            if (emitter.role === 'leg') {
                emitter.node.setRotationFromEuler(0, direction * emitter.forwardTilt, emitter.lateralTilt);
            } else {
                emitter.node.setRotationFromEuler(TUNING.particleSystem.emitterEulerX, direction * emitter.forwardTilt, emitter.lateralTilt);
            }
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
        const speed = emitter.role === 'leg'
            ? lerp(TUNING.behavior.legSpeedMin, TUNING.behavior.legSpeedMax, speedRatio) * pullScale
            : lerp(TUNING.behavior.handSpeedMin, TUNING.behavior.handSpeedMax, speedRatio) * pullScale;
        setCurveRangeTwoConstants(emitter.system.startSpeed, speed * TUNING.behavior.speedRangeMinScale, speed * TUNING.behavior.speedRangeMaxScale);
        setCurveRangeTwoConstants(
            emitter.system.startLifetime,
            emitter.role === 'leg' ? TUNING.behavior.legLifetimeMin : TUNING.behavior.handLifetimeMin,
            emitter.role === 'leg'
                ? lerp(TUNING.behavior.legLifetimeMaxLowSpeed, TUNING.behavior.legLifetimeMaxHighSpeed, speedRatio)
                : lerp(TUNING.behavior.handLifetimeMaxLowSpeed, TUNING.behavior.handLifetimeMaxHighSpeed, speedRatio),
        );
        setCurveRange(emitter.system.gravityModifier, emitter.role === 'leg' ? TUNING.particleSystem.legGravity : TUNING.particleSystem.handGravity);
        const size = emitter.role === 'leg'
            ? lerp(TUNING.behavior.legSizeMin, TUNING.behavior.legSizeMax, speedRatio)
            : lerp(TUNING.behavior.handSizeMin, TUNING.behavior.handSizeMax, speedRatio);
        setCurveRangeTwoConstants(emitter.system.startSizeX, size * TUNING.behavior.sizeRangeMinScale, size * TUNING.behavior.sizeRangeMaxScale);
        setCurveRangeTwoConstants(emitter.system.startSizeY, size * TUNING.behavior.sizeRangeMinScale, size * TUNING.behavior.sizeRangeMaxScale);
        setCurveRangeTwoConstants(emitter.system.startSizeZ, size * TUNING.behavior.sizeRangeMinScale, size * TUNING.behavior.sizeRangeMaxScale);
        this.node.active = true;
        emitter.system.play();
        applyParticleTexture(emitter.system);
        const scaledCount = Math.max(TUNING.behavior.minimumScaledCount, Math.round(count * emitter.countScale));
        const spraySeconds = emitter.role === 'leg' ? TUNING.behavior.legSpraySeconds : TUNING.behavior.handSpraySeconds;
        this.emitJitteredParticles(
            emitter,
            Math.max(
                emitter.role === 'leg' ? TUNING.behavior.legInitialEmitMin : TUNING.behavior.handInitialEmitMin,
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
        applyParticleTexture(emitter.system);
        this.emitJitteredParticles(emitter, emitCount, dt);
    }

    private emitJitteredParticles(emitter: SplashParticleEmitter, count: number, dt: number) {
        const basePosition = emitter.node.position.clone();
        const baseEuler = emitter.node.eulerAngles.clone();
        const positionJitterX = emitter.role === 'leg' ? TUNING.behavior.legJitterX : TUNING.behavior.handJitterX;
        const positionJitterY = emitter.role === 'leg' ? TUNING.behavior.legJitterY : TUNING.behavior.handJitterY;
        const positionJitterZ = emitter.role === 'leg' ? TUNING.behavior.legJitterZ : TUNING.behavior.handJitterZ;
        const rotationJitterX = emitter.role === 'leg' ? TUNING.behavior.legRotationJitterX : TUNING.behavior.handRotationJitterX;
        const rotationJitterY = emitter.role === 'leg' ? TUNING.behavior.legRotationJitterY : TUNING.behavior.handRotationJitterY;
        const rotationJitterZ = emitter.role === 'leg' ? TUNING.behavior.legRotationJitterZ : TUNING.behavior.handRotationJitterZ;
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

    private legSurfaceContact(emitter: SplashParticleEmitter): number {
        const boneName = emitter.side === 'left' ? 'LeftLeg' : 'RightLeg';
        if (!this._options.getBoneWorldPosition(boneName, this._tmpEmitterWorld)) {
            return 0;
        }

        const depthBelowSurface = this._waterY - this._tmpEmitterWorld.y;
        if (depthBelowSurface > TUNING.behavior.legSurfaceMaxDepth) {
            return 0;
        }
        if (depthBelowSurface < TUNING.behavior.legSurfaceMaxAbove) {
            return 0;
        }
        return 1 - smoothRange(Math.abs(depthBelowSurface), TUNING.behavior.legSurfaceSoftStart, TUNING.behavior.legSurfaceSoftEnd);
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

function setGradientColor(range: GradientRange, color: Color) {
    if (!range) {
        return;
    }
    range.mode = GradientRange.Mode.Color;
    range.color = color;
}

function setParticleFadeOut(system: ParticleSystem) {
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
    const startAlpha = new AlphaKey();
    startAlpha.alpha = 1;
    startAlpha.time = 0;
    const holdAlpha = new AlphaKey();
    holdAlpha.alpha = TUNING.particleSystem.fadeHoldAlpha;
    holdAlpha.time = TUNING.particleSystem.fadeHoldTime;
    const endAlpha = new AlphaKey();
    endAlpha.alpha = TUNING.particleSystem.fadeEndAlpha;
    endAlpha.time = 1;
    const gradient = new Gradient();
    gradient.setKeys([startColor, endColor], [startAlpha, holdAlpha, endAlpha]);

    module.enable = true;
    module.color.mode = GradientRange.Mode.Gradient;
    module.color.gradient = gradient;
}

function setParticleSizeOverLifetime(system: ParticleSystem) {
    const module = system.sizeOvertimeModule;
    if (!module?.size) {
        return;
    }

    const curve = new RealCurve();
    curve.assignSorted(TUNING.particleSystem.sizeOverLifetime.map(([time, value]) => [time, value]));

    module.enable = true;
    module.separateAxes = false;
    module.size.mode = CurveRange.Mode.Curve;
    module.size.spline = curve;
    module.size.multiplier = 1;
}

function getSplashParticleTexture(): Texture2D {
    if (_splashParticleTexture) {
        return _splashParticleTexture;
    }

    const size = TUNING.particleTexture.size;
    const center = (size - 1) * 0.5;
    const radius = center;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x - center) / radius;
            const dy = (y - center) / radius;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const core = 1 - smoothRange(distance, TUNING.particleTexture.coreRadius, 1);
            const highlight = 1 - smoothRange(distance, 0, TUNING.particleTexture.highlightRadius);
            const alpha = Math.round(255 * clamp(Math.max(core, highlight * TUNING.particleTexture.highlightAlphaScale), 0, 1));
            const index = (y * size + x) * 4;
            data[index] = 255;
            data[index + 1] = 255;
            data[index + 2] = 255;
            data[index + 3] = alpha;
        }
    }

    const texture = new Texture2D('RuntimeSplashParticleDot');
    texture.create(size, size, Texture2D.PixelFormat.RGBA8888);
    texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    texture.uploadData(data);
    _splashParticleTexture = texture;
    return texture;
}

function applyParticleTexture(system: ParticleSystem) {
    const texture = getSplashParticleTexture();
    system.priority = TUNING.renderPriority;
    system.setSharedMaterial(null, 0);
    const renderer = system.renderer as any;
    if (renderer) {
        renderer.particleMaterial = null;
        renderer.cpuMaterial = null;
        renderer.mainTexture = texture;
    }
}

function smoothRange(value: number, start: number, end: number): number {
    if (end <= start) {
        return value >= end ? 1 : 0;
    }
    const t = clamp((value - start) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
}

function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}
