import { Material, MeshRenderer, Node, primitives, resources, utils, Vec3, Vec4 } from 'cc';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

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

export type SplashEmitterState = {
    armAction: number;
    kickAction: number;
    armCycleMotion: number;
    kickCycleMotion: number;
    leftHandWaterContact: number;
    rightHandWaterContact: number;
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
    leftHandWaterContact: 0,
    rightHandWaterContact: 0,
    leftHandWaterProgress: 0,
    rightHandWaterProgress: 0,
};

export class SplashEmitter {
    public readonly node: Node;

    private readonly _parts: SplashPart[] = [];
    private readonly _tmpWorld = new Vec3();
    private readonly _tmpLocal = new Vec3();
    private _state: SplashEmitterState = EMPTY_STATE;
    private _splashBurst = 0;
    private _armSplashBurst = 0;
    private _kickSplashBurst = 0;
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
            this.createPart(material, 'LeftHandFoam', new Vec3(0.28, 0.004, -0.38), new Vec3(0, 0, -8), new Vec3(0.42, 1, 0.32), 0.3, 1.35, 0.04, 0.95, 0.82, 0.68, 0.18, 0.45);
            this.createPart(material, 'RightHandFoam', new Vec3(0.28, 0.004, 0.38), new Vec3(0, 0, 8), new Vec3(0.42, 1, 0.32), 0.3, 1.35, 0.04, 0.95, 0.82, 0.68, 0.18, 0.45);
            this.createPart(material, 'FootFoam', new Vec3(-0.94, 0.005, 0), new Vec3(0, 0, 0), new Vec3(0.72, 1, 0.48), 0.85, 0.04, 1.65, 1.0, 1.34, 0.78, 1.0, 1.0);
            this.update(0);
        });
    }

    triggerArmStroke() {
        this._armSplashBurst = Math.max(this._armSplashBurst, 1.15);
        this._splashBurst = Math.max(this._splashBurst, 1);
    }

    triggerKick() {
        this._kickSplashBurst = Math.max(this._kickSplashBurst, 1.25);
        this._splashBurst = Math.max(this._splashBurst, 0.65);
    }

    triggerBurst(scale = 1) {
        const safeScale = Math.max(0, scale);
        this._splashBurst = Math.max(this._splashBurst, safeScale);
        this._armSplashBurst = Math.max(this._armSplashBurst, safeScale * 0.85);
        this._kickSplashBurst = Math.max(this._kickSplashBurst, safeScale * 0.7);
        this.update(0.8);
    }

    decay(dt: number) {
        this._splashBurst = Math.max(0, this._splashBurst - dt * 2.8);
        this._armSplashBurst = Math.max(0, this._armSplashBurst - dt * 3.2);
        this._kickSplashBurst = Math.max(0, this._kickSplashBurst - dt * 3.8);
    }

    reset() {
        this._splashBurst = 0;
        this._armSplashBurst = 0;
        this._kickSplashBurst = 0;
        this._state = EMPTY_STATE;
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

        const speedRatio = clamp(speed / 3.2, 0, 1);
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
                    speedRatio * part.speedWeight * 0.35
                    + this._state.armAction * part.armWeight
                    + this._splashBurst * part.burstWeight * 0.18
                    + this._armSplashBurst * part.armWeight * 0.7
                )
                : speedRatio * part.speedWeight
                    + this._state.armAction * part.armWeight
                    + this._state.kickAction * part.kickWeight
                    + this._splashBurst * part.burstWeight * 0.45
                    + this._armSplashBurst * part.armWeight * 0.5
                    + this._kickSplashBurst * part.kickWeight * 0.5;
            const motionFloor = isFoot
                ? speedRatio * 0.42 + this._state.kickCycleMotion * 0.58
                : isHand
                    ? handContact * (speedRatio * 0.08 + this._state.armCycleMotion * 0.72)
                    : speedRatio * 0.16;
            const action = Math.max(rawAction, motionFloor);
            const intensity = clamp(action, 0, 2.4);
            const burst = isHand
                ? handContact * Math.max(
                    this._splashBurst * part.burstWeight * 0.28,
                    this._armSplashBurst * part.armWeight,
                    this._state.armCycleMotion * 0.45,
                )
                : Math.max(
                    this._splashBurst * part.burstWeight,
                    this._armSplashBurst * part.armWeight,
                    this._kickSplashBurst * part.kickWeight,
                );
            const active = isHand ? handContact > 0.08 && (intensity > 0.04 || burst > 0.04) : intensity > 0.04 || burst > 0.04;
            part.node.active = active;
            anyActive = anyActive || active;

            const surge = Math.min(1, burst * 0.45);
            const footBoost = isFoot ? 1.14 : 1;
            this.resolvePartPosition(part, speedRatio, surge, isFoot, isHand, handContact);
            part.node.setRotationFromEuler(part.baseEuler.x, part.baseEuler.y, part.baseEuler.z);
            part.node.setScale(
                part.baseScale.x * footBoost * (1 + speedRatio * 0.28 + surge * 0.55),
                1,
                part.baseScale.z * footBoost * (1 + surge * 0.58),
            );
            part.params.set(intensity, speedRatio, Math.min(2.4, burst), part.seed);
            part.material.setProperty('splashParams', part.params);
        }
        this.node.active = anyActive;
    }

    private createPart(
        sourceMaterial: Material,
        name: string,
        basePosition: Vec3,
        baseEuler: Vec3,
        baseScale: Vec3,
        speedWeight: number,
        armWeight: number,
        kickWeight: number,
        burstWeight: number,
        width = 1.1,
        length = 0.95,
        flowStrength = 0.25,
        trailStrength = 0.6,
    ) {
        const node = new Node(name);
        node.setParent(this.node);
        node.setPosition(basePosition);
        node.setRotationFromEuler(baseEuler.x, baseEuler.y, baseEuler.z);
        node.setScale(baseScale);

        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.plane({
            width,
            length,
            widthSegments: 4,
            lengthSegments: 2,
        }));

        const runtimeMaterial = new Material();
        runtimeMaterial.copy(sourceMaterial);
        runtimeMaterial.name = `Runtime${name}`;
        runtimeMaterial.setProperty('shapeParams', new Vec4(flowStrength, trailStrength, 0, 0));
        renderer.setMaterial(runtimeMaterial, 0);

        this._parts.push({
            node,
            material: runtimeMaterial,
            params: new Vec4(),
            shapeParams: new Vec4(flowStrength, trailStrength, 0, 0),
            seed: Math.random() * 20,
            basePosition: basePosition.clone(),
            baseEuler: baseEuler.clone(),
            baseScale: baseScale.clone(),
            speedWeight,
            armWeight,
            kickWeight,
            burstWeight,
        });
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
            this._tmpWorld.y = this._waterY + part.basePosition.y + surge * 0.004;
            this._tmpWorld.x -= speedRatio * (isFoot ? 0.34 : 0.08);
            this.node.inverseTransformPoint(this._tmpLocal, this._tmpWorld);
            part.node.setPosition(this._tmpLocal);
            return;
        }

        part.node.setPosition(
            part.basePosition.x - speedRatio * 0.14 + (isFoot ? -speedRatio * 0.26 : 0),
            part.basePosition.y + surge * 0.004,
            part.basePosition.z,
        );
    }

    private resolveHandPartPosition(part: SplashPart, speedRatio: number, surge: number, handContact: number) {
        const progress = this.handProgressForPart(part.node.name);
        const strokeX = lerp(0.78, 0.28, progress);
        const baseX = lerp(part.basePosition.x, strokeX, handContact) - speedRatio * 0.08;
        const baseY = part.basePosition.y + surge * 0.004;
        const baseZ = part.basePosition.z;
        part.node.setPosition(baseX, baseY, baseZ);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
