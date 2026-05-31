import { _decorator, Component, Node, Tween, Vec3, tween } from 'cc';
import {
    BASE_SPEED,
    MAX_SPEED,
    RACE_DISTANCE,
    Rating,
    StrokeType,
    TARGET_INTERVAL,
} from '../core/GameConstants';
import { RhythmEvaluator, RhythmResult } from '../core/RhythmEvaluator';
import { CartoonSwimmerRig } from './CartoonSwimmerRig';

const { ccclass, property } = _decorator;

const INPUT_RATE_WINDOW = 1.2;
const TARGET_LIMB_RATE = 1 / (TARGET_INTERVAL * 2);
const MAX_SWIM_ACCEL = 1.85;
const KICK_START_ACCEL = 2.45;
const BASE_DRAG = 0.34;
const HIGH_SPEED_DRAG = 0.46;
const HIGH_SPEED_DESYNC_PENALTY = 1.15;
const MIN_SWIM_SPEED = 0;

@ccclass('Swimmer')
export class Swimmer extends Component {
    @property(Node) public bodyNode: Node = null;
    @property(Node) public headNode: Node = null;
    @property(Node) public armNode: Node = null;
    @property(Node) public legNode: Node = null;
    @property(Node) public rearArmNode: Node = null;
    @property(Node) public rearLegNode: Node = null;
    @property(Node) public splashNode: Node = null;
    @property(Node) public modelRootNode: Node = null;
    @property(Node) public modelHead: Node = null;
    @property(Node) public modelSpine: Node = null;
    @property(Node) public modelLeftArm: Node = null;
    @property(Node) public modelLeftForeArm: Node = null;
    @property(Node) public modelRightArm: Node = null;
    @property(Node) public modelRightForeArm: Node = null;
    @property(Node) public modelLeftUpLeg: Node = null;
    @property(Node) public modelLeftLeg: Node = null;
    @property(Node) public modelRightUpLeg: Node = null;
    @property(Node) public modelRightLeg: Node = null;
    @property public boundModelBoneCount = 0;
    @property(CartoonSwimmerRig) public cartoonRig: CartoonSwimmerRig = null;
    @property(RhythmEvaluator) public rhythmEvaluator: RhythmEvaluator = null;
    @property public isAI = false;
    @property public aiPower = 1;
    @property public aiMaxSpeedScale = 1;
    @property public swimmerName = 'Swimmer';

    private _currentSpeed = 0;
    private _distance = 0;
    private _isRacing = false;
    private _startPosition = new Vec3();
    private _hasStartPosition = false;
    private _bodyPhase = 0;
    private _fatigue = 0;
    private _armCycle = 0;
    private _kickCycle = 0;
    private _motionClock = 0;
    private _armMotionRemaining = 0;
    private _kickMotionRemaining = 0;
    private _armInputTimes: number[] = [];
    private _kickInputTimes: number[] = [];
    private _armInputRate = 0;
    private _kickInputRate = 0;
    private _syncScore = 0;
    private _effortScore = 0;
    private _armAction = 0;
    private _kickAction = 0;
    private _comboSpeedBonus = 0;
    private _modelBaseRootEuler = new Vec3(90, 0, -90);
    private _modelBaseRootPos = new Vec3(0, 0.1, 0);
    private _boneBaseEuler = new Map<Node, Vec3>();

    start() {
        this.captureStartPosition();
    }

    startRace() {
        this.captureStartPosition();
        this._isRacing = true;
        this._currentSpeed = BASE_SPEED;
        this._distance = 0;
        this._fatigue = 0;
        this._armCycle = 0;
        this._kickCycle = 0;
        this._motionClock = 0;
        this._armMotionRemaining = 0;
        this._kickMotionRemaining = 0;
        this._armInputTimes.length = 0;
        this._kickInputTimes.length = 0;
        this._armInputRate = 0;
        this._kickInputRate = 0;
        this._syncScore = 0;
        this._effortScore = 0;
        this._armAction = 0;
        this._kickAction = 0;
        this._comboSpeedBonus = 0;
        this.node.setPosition(this._startPosition);
        this.cartoonRig?.setPreRaceStanding(false);
        this.resetPose();
        this.cartoonRig?.setActiveSwimming(true);
    }

    stopRace() {
        this._isRacing = false;
        this.cartoonRig?.setActiveSwimming(false);
    }

    update(dt: number) {
        if (!this._isRacing) {
            return;
        }

        this._fatigue = Math.min(0.22, this._fatigue + dt * 0.004);
        this._armAction = Math.max(0, this._armAction - dt * 4.6);
        this._kickAction = Math.max(0, this._kickAction - dt * 6.8);
        this.updateStrokeMetrics(dt);
        this.updateSpeedPhysics(dt);
        this._distance = Math.min(RACE_DISTANCE, this._distance + this._currentSpeed * dt);

        const x = this._startPosition.x + this._distance;
        this.node.setPosition(x, this._startPosition.y, this._startPosition.z);
        this.updateBodyMotion(dt);

        if (this._distance >= RACE_DISTANCE) {
            this._isRacing = false;
            this.node.emit('swimmer-finished', this);
        }
    }

    handleStroke(type: StrokeType): RhythmResult | null {
        if (!this._isRacing || !this.rhythmEvaluator) {
            return null;
        }

        const result = this.rhythmEvaluator.evaluate(type);
        this._comboSpeedBonus = Math.max(0, result.speedMultiplier - 1);
        this.playStroke(type, result.rating);
        return result;
    }

    playFinishRagdoll() {
        this._isRacing = false;
        this.cartoonRig?.setActiveSwimming(false);
        tween(this.node)
            .to(0.14, { eulerAngles: new Vec3(0, 0, -8) })
            .to(0.22, { eulerAngles: new Vec3(8, 0, 18), position: new Vec3(this.node.position.x + 1.15, this.node.position.y - 0.12, this.node.position.z) })
            .to(0.18, { eulerAngles: new Vec3(0, 0, 0) })
            .start();
    }

    reset() {
        this.captureStartPosition();
        this._currentSpeed = 0;
        this._distance = 0;
        this._isRacing = false;
        this._bodyPhase = 0;
        this._fatigue = 0;
        this._armCycle = 0;
        this._kickCycle = 0;
        this._motionClock = 0;
        this._armMotionRemaining = 0;
        this._kickMotionRemaining = 0;
        this._armInputTimes.length = 0;
        this._kickInputTimes.length = 0;
        this._armInputRate = 0;
        this._kickInputRate = 0;
        this._syncScore = 0;
        this._effortScore = 0;
        this._armAction = 0;
        this._kickAction = 0;
        this._comboSpeedBonus = 0;
        this.rhythmEvaluator?.reset();
        this.node.setPosition(this._startPosition);
        this.node.setRotationFromEuler(0, 0, 0);
        this.resetPose();
        this.cartoonRig?.setActiveSwimming(false);
        this.cartoonRig?.setPreRaceStanding(true);
    }

    private playStroke(type: StrokeType, rating: Rating) {
        const powerScale = rating === Rating.PERFECT ? 1.18 : rating === Rating.MISS ? 0.72 : 1;
        if (type === StrokeType.ARM) {
            this.queueStrokeMotion(this._armInputTimes, Math.PI * 2);
            this._armAction = 1;
            this.cartoonRig?.triggerArmStroke();
            this.pulseModel(10, 0.18 / powerScale);
            this.freestyleArmPull(this.armNode, new Vec3(0.64, 0.08, -0.52), -4, new Vec3(-0.1, -0.03, -0.5), -150, 0.26 / powerScale);
            this.freestyleArmPull(this.rearArmNode, new Vec3(0.12, 0.2, 0.52), 42, new Vec3(0.7, 0.12, 0.52), -2, 0.28 / powerScale);
        } else {
            this.queueStrokeMotion(this._kickInputTimes, Math.PI * 2);
            this._kickAction = 1;
            this.cartoonRig?.triggerKick();
            this.pulseModel(-7, 0.12 / powerScale);
            this.flutterKick(this.legNode, new Vec3(-1.02, -0.08, -0.25), 164, 0.12 / powerScale);
            this.flutterKick(this.rearLegNode, new Vec3(-1.02, 0.18, 0.25), 198, 0.12 / powerScale);
        }
        this.flashSplash(rating);
    }

    private freestyleArmPull(target: Node, catchPos: Vec3, catchAngle: number, pullPos: Vec3, pullAngle: number, duration: number) {
        if (!target) {
            return;
        }
        Tween.stopAllByTarget(target);
        tween(target)
            .to(duration * 0.34, { eulerAngles: new Vec3(0, 0, catchAngle), position: catchPos })
            .to(duration * 0.38, { eulerAngles: new Vec3(0, 0, pullAngle), position: pullPos })
            .to(duration * 0.28, { eulerAngles: this.restEulerFor(target), position: this.restPositionFor(target) })
            .start();
    }

    private flutterKick(target: Node, activePos: Vec3, activeAngle: number, duration: number) {
        if (!target) {
            return;
        }
        Tween.stopAllByTarget(target);
        tween(target)
            .to(duration, { eulerAngles: new Vec3(0, 0, activeAngle), position: activePos })
            .to(duration, { eulerAngles: this.restEulerFor(target), position: this.restPositionFor(target) })
            .start();
    }

    private updateBodyMotion(dt: number) {
        const armCycleSpeed = this.motionSpeedForRate(this._armInputRate, Math.PI * 2, 0.82, 5.2);
        const kickCycleSpeed = this.motionSpeedForRate(this._kickInputRate, Math.PI * 2, 0.82, 5.2);

        this._bodyPhase += dt * Math.max(6, this._currentSpeed * 1.2);
        this._armCycle += this.advanceQueuedMotion(dt, armCycleSpeed, true);
        this._kickCycle += this.advanceQueuedMotion(dt, kickCycleSpeed, false);
        const bob = Math.sin(this._bodyPhase) * 0.045;
        const roll = Math.sin(this._armCycle) * 9;
        if (this.cartoonRig) {
            this.cartoonRig.updateFreestyle(dt, this._armCycle, this._kickCycle, this._bodyPhase, this._currentSpeed);
            return;
        }
        this.bodyNode?.setPosition(0, 0.18 + bob, 0);
        this.bodyNode?.setRotationFromEuler(0, roll * 0.35, 0);
        this.headNode?.setPosition(1.23, 0.28 + bob * 0.45, 0);
        this.applyFreestyleArm(this.armNode, Math.sin(this._armCycle), -0.48, false, 1 + this._armAction * 0.55);
        this.applyFreestyleArm(this.rearArmNode, Math.sin(this._armCycle + Math.PI), 0.48, true, 1 + this._armAction * 0.55);
        this.applyFlutterKick(this.legNode, Math.sin(this._kickCycle), -0.24, 1 + this._kickAction * 0.75);
        this.applyFlutterKick(this.rearLegNode, Math.sin(this._kickCycle + Math.PI), 0.24, 1 + this._kickAction * 0.75);
    }

    private queueStrokeMotion(times: number[], cycleAmount: number) {
        times.push(this._motionClock);
        this.pruneInputTimes(times);
        if (times === this._armInputTimes) {
            this._armMotionRemaining += cycleAmount;
        } else {
            this._kickMotionRemaining += cycleAmount;
        }
    }

    private advanceQueuedMotion(dt: number, speed: number, arm: boolean): number {
        const remaining = arm ? this._armMotionRemaining : this._kickMotionRemaining;
        if (remaining <= 0) {
            return 0;
        }

        const step = Math.min(remaining, speed * dt);
        if (arm) {
            this._armMotionRemaining -= step;
        } else {
            this._kickMotionRemaining -= step;
        }
        return step;
    }

    private motionSpeedForRate(ratePerSecond: number, cycleAmount: number, minCyclesPerSecond: number, maxCyclesPerSecond: number): number {
        const cyclesPerSecond = Math.max(minCyclesPerSecond, Math.min(maxCyclesPerSecond, ratePerSecond));
        return cycleAmount * cyclesPerSecond;
    }

    private updateStrokeMetrics(dt: number) {
        this._motionClock += dt;
        this.pruneInputTimes(this._armInputTimes);
        this.pruneInputTimes(this._kickInputTimes);
        this._armInputRate = this.inputRatePerSecond(this._armInputTimes);
        this._kickInputRate = this.inputRatePerSecond(this._kickInputTimes);
        this._effortScore = this.calculateEffortScore(this._armInputRate, this._kickInputRate);
        this._syncScore = this.calculateSyncScore(this._armInputRate, this._kickInputRate);
    }

    private updateSpeedPhysics(dt: number) {
        const rhythmBonus = this.isAI ? 0 : this._comboSpeedBonus;
        const maxSpeed = MAX_SPEED * (this.isAI ? this.aiMaxSpeedScale : 1 + rhythmBonus * 0.18);
        const aiPower = this.isAI ? this.aiPower : 1;
        const speedRatio = clamp01(this._currentSpeed / maxSpeed);
        const accelLimit = 0.16 + 0.84 * (1 - Math.pow(speedRatio, 1.6));
        const syncedEffort = this._effortScore * this._syncScore;
        const kickEffort = clamp01(this._kickInputRate / TARGET_LIMB_RATE);
        const armEffort = clamp01(this._armInputRate / TARGET_LIMB_RATE);
        const kickLaunchPhase = 1 - smoothRange(this._distance, 15, 18);
        const kickOnlyBias = kickEffort * (1 - armEffort) * kickLaunchPhase;
        const earlySyncScale = 1 - kickLaunchPhase * 0.72;
        const startAssist = 1 - smoothRange(speedRatio, 0.4, 0.58);
        const kickStartAccel = KICK_START_ACCEL * kickEffort * startAssist;
        const kickOnlyLaunchAccel = KICK_START_ACCEL * 0.9 * kickOnlyBias * startAssist;
        const comboAccelScale = 1 + rhythmBonus * 0.7;
        const accel = (MAX_SWIM_ACCEL * syncedEffort * accelLimit * earlySyncScale + kickStartAccel + kickOnlyLaunchAccel) * (1 - this._fatigue) * aiPower * comboAccelScale;
        const dragRelief = Math.max(syncedEffort * 0.55, kickEffort * startAssist * 0.42);
        const aiDragScale = this.isAI ? Math.max(0.7, 1 - (aiPower - 1) * 0.32) : 1;
        const drag = (BASE_DRAG + HIGH_SPEED_DRAG * speedRatio) * (1 - dragRelief) * aiDragScale;
        const highSpeedPenaltyScale = smoothRange(speedRatio, 0.68, 0.98);
        const activeInput = clamp01((this._armInputRate + this._kickInputRate) / (TARGET_LIMB_RATE * 2));
        const desyncPenalty = HIGH_SPEED_DESYNC_PENALTY * (1 - this._syncScore) * highSpeedPenaltyScale * activeInput;

        this._currentSpeed = clamp(this._currentSpeed + (accel - drag - desyncPenalty) * dt, MIN_SWIM_SPEED, maxSpeed);
    }

    private calculateEffortScore(armRate: number, kickRate: number): number {
        return clamp01(((armRate + kickRate) * 0.5) / TARGET_LIMB_RATE);
    }

    private calculateSyncScore(armRate: number, kickRate: number): number {
        const maxRate = Math.max(armRate, kickRate);
        if (maxRate < 0.15) {
            return 0;
        }
        const minRate = Math.min(armRate, kickRate);
        const balance = minRate / maxRate;
        const rateMatch = 1 - clamp01(Math.abs(armRate - kickRate) / (TARGET_LIMB_RATE * 1.1));
        return clamp01(rateMatch * 0.68 + balance * 0.32);
    }

    private inputRatePerSecond(times: number[]): number {
        return times.length / INPUT_RATE_WINDOW;
    }

    private pruneInputTimes(times: number[]) {
        while (times.length > 0 && this._motionClock - times[0] > INPUT_RATE_WINDOW) {
            times.shift();
        }
    }

    private flashSplash(rating: Rating) {
        if (this.cartoonRig) {
            const scale = rating === Rating.PERFECT ? 1.15 : rating === Rating.MISS ? 0.55 : 0.85;
            this.cartoonRig.triggerSplashBurst(scale);
            return;
        }
        if (!this.splashNode) {
            return;
        }
        const scale = rating === Rating.PERFECT ? 1.45 : rating === Rating.MISS ? 0.75 : 1;
        this.splashNode.active = true;
        this.splashNode.setScale(scale, scale, scale);
        tween(this.splashNode)
            .to(0.12, { scale: new Vec3(scale * 1.35, scale * 0.65, scale * 1.1) })
            .call(() => {
                if (this.splashNode) {
                    this.splashNode.active = false;
                }
            })
            .start();
    }

    private resetPose() {
        this.bodyNode?.setPosition(0, 0.18, 0);
        this.bodyNode?.setRotationFromEuler(0, 0, 0);
        this.headNode?.setPosition(1.23, 0.28, 0);
        this.armNode?.setPosition(0.55, 0.02, -0.48);
        this.armNode?.setRotationFromEuler(0, 0, -4);
        this.rearArmNode?.setPosition(0.05, 0.02, 0.48);
        this.rearArmNode?.setRotationFromEuler(0, 0, -154);
        this.legNode?.setPosition(-0.62, -0.02, -0.24);
        this.legNode?.setRotationFromEuler(0, 0, 178);
        this.rearLegNode?.setPosition(-0.62, -0.02, 0.24);
        this.rearLegNode?.setRotationFromEuler(0, 0, 184);
        this.resetArmSegments(this.armNode, false);
        this.resetArmSegments(this.rearArmNode, true);
        this.resetLegSegments(this.legNode);
        this.resetLegSegments(this.rearLegNode);
        this.cartoonRig?.resetPose();
        if (this.splashNode) {
            this.splashNode.active = false;
        }
        if (this.modelRootNode) {
            this.modelRootNode?.setPosition(0, 0.1, 0);
            this.modelRootNode?.setRotationFromEuler(90, 0, -90);
            this.resetModelPose();
        }
    }

    private pulseModel(roll: number, duration: number) {
        if (!this.modelRootNode) {
            return;
        }
        Tween.stopAllByTarget(this.modelRootNode);
        tween(this.modelRootNode)
            .to(duration, { eulerAngles: new Vec3(92, roll * 1.4, -90 + roll * 0.25), position: new Vec3(0.16, 0.12, 0.08) })
            .to(duration, { eulerAngles: new Vec3(90, 0, -90), position: new Vec3(0, 0.1, 0) })
            .start();
    }

    private updateModelFreestylePose(bob: number, roll: number) {
        if (this._boneBaseEuler.size === 0) {
            this.captureModelBindPose();
        }

        const arm = Math.sin(this._armCycle);
        const armOpposite = Math.sin(this._armCycle + Math.PI);
        const kick = Math.sin(this._kickCycle);
        const kickOpposite = Math.sin(this._kickCycle + Math.PI);

        this.modelRootNode.setPosition(
            this._modelBaseRootPos.x + Math.sin(this._armCycle) * 0.04,
            this._modelBaseRootPos.y + bob * 0.55,
            this._modelBaseRootPos.z + Math.sin(this._kickCycle) * 0.02,
        );
        this.modelRootNode.setRotationFromEuler(
            this._modelBaseRootEuler.x + Math.sin(this._kickCycle) * 1.5,
            this._modelBaseRootEuler.y + roll * 0.55,
            this._modelBaseRootEuler.z + Math.sin(this._armCycle) * 2.5,
        );

        this.applyBoneOffset(this.modelSpine, 0, roll * 0.45, Math.sin(this._armCycle) * 3);
        this.applyBoneOffset(this.modelHead, -4, roll * 0.2, Math.sin(this._armCycle + 0.8) * 2);

        this.applyBoneOffset(this.modelLeftArm, -38 - Math.max(0, -arm) * 36, 0, -18 + arm * 22);
        this.applyBoneOffset(this.modelLeftForeArm, -20 - Math.max(0, -arm) * 34, 0, 8);
        this.applyBoneOffset(this.modelRightArm, -38 - Math.max(0, -armOpposite) * 36, 0, 18 + armOpposite * 22);
        this.applyBoneOffset(this.modelRightForeArm, -20 - Math.max(0, -armOpposite) * 34, 0, -8);

        this.applyBoneOffset(this.modelLeftUpLeg, kick * 18, 0, -3);
        this.applyBoneOffset(this.modelLeftLeg, -kick * 24, 0, 0);
        this.applyBoneOffset(this.modelRightUpLeg, kickOpposite * 18, 0, 3);
        this.applyBoneOffset(this.modelRightLeg, -kickOpposite * 24, 0, 0);
    }

    private resetModelPose() {
        if (this.modelRootNode) {
            this.modelRootNode.setPosition(this._modelBaseRootPos);
            this.modelRootNode.setRotationFromEuler(this._modelBaseRootEuler.x, this._modelBaseRootEuler.y, this._modelBaseRootEuler.z);
        }
        for (const [bone, euler] of this._boneBaseEuler) {
            if (bone?.isValid) {
                bone.setRotationFromEuler(euler.x, euler.y, euler.z);
            }
        }
    }

    private captureModelBindPose() {
        if (!this.modelRootNode) {
            return;
        }
        this._modelBaseRootEuler = this.modelRootNode.eulerAngles.clone();
        this._modelBaseRootPos = this.modelRootNode.position.clone();
        this._boneBaseEuler.clear();
        for (const bone of [
            this.modelHead,
            this.modelSpine,
            this.modelLeftArm,
            this.modelLeftForeArm,
            this.modelRightArm,
            this.modelRightForeArm,
            this.modelLeftUpLeg,
            this.modelLeftLeg,
            this.modelRightUpLeg,
            this.modelRightLeg,
        ]) {
            if (bone) {
                this._boneBaseEuler.set(bone, bone.eulerAngles.clone());
            }
        }
    }

    private applyBoneOffset(bone: Node, x: number, y: number, z: number) {
        if (!bone) {
            return;
        }
        const base = this._boneBaseEuler.get(bone);
        if (!base) {
            return;
        }
        bone.setRotationFromEuler(base.x + x, base.y + y, base.z + z);
    }

    private applyFreestyleArm(target: Node, phase: number, laneOffsetZ: number, rear: boolean, power: number) {
        if (!target) {
            return;
        }

        const recovery = Math.max(0, phase);
        const pull = Math.max(0, -phase);
        const forward = rear ? 0.08 + recovery * 0.76 * power : 0.54 + recovery * 0.36 * power;
        const height = 0.04 + recovery * 0.28 * power - pull * 0.08 * power;
        const rootAngle = rear
            ? -152 + recovery * 154 * power - pull * 16
            : -8 - pull * 142 * power + recovery * 28;
        target.setPosition(forward, height, laneOffsetZ);
        target.setRotationFromEuler(recovery * -18, 0, rootAngle);

        const foreArm = target.getChildByName('ForeArm');
        const hand = target.getChildByName('Hand');
        const elbow = target.getChildByName('Elbow');
        const elbowBend = rear
            ? 56 + recovery * 40 * power - pull * 18
            : 86 - pull * 66 * power + recovery * 34;
        foreArm?.setPosition(0.76, recovery * 0.16 * power - pull * 0.07 * power, 0);
        foreArm?.setRotationFromEuler(0, 0, elbowBend);
        hand?.setPosition(1.1, recovery * 0.34 * power - pull * 0.16 * power, 0);
        hand?.setRotationFromEuler(0, 0, -18 - pull * 28 * power + recovery * 22);
        elbow?.setPosition(0.5, recovery * 0.06, 0);
    }

    private applyFlutterKick(target: Node, phase: number, laneOffsetZ: number, power: number) {
        if (!target) {
            return;
        }

        const up = Math.max(0, phase);
        const down = Math.max(0, -phase);
        target.setPosition(-0.74, -0.02 + phase * 0.2 * power, laneOffsetZ);
        target.setRotationFromEuler(0, 0, 180 - phase * 24 * power);

        const calf = target.getChildByName('Calf');
        const foot = target.getChildByName('Foot');
        const knee = target.getChildByName('Knee');
        calf?.setPosition(0.82, 0.02 - down * 0.12 * power + up * 0.05 * power, 0);
        calf?.setRotationFromEuler(0, 0, 88 + down * 34 * power - up * 16 * power);
        foot?.setPosition(1.22, 0.02 - down * 0.22 * power + up * 0.1 * power, 0);
        foot?.setRotationFromEuler(0, 0, -14 - down * 28 * power + up * 16 * power);
        knee?.setPosition(0.54, -down * 0.05 + up * 0.03, 0);
    }

    private resetArmSegments(target: Node, rear: boolean) {
        if (!target) {
            return;
        }
        target.getChildByName('ForeArm')?.setPosition(0.77, rear ? 0.12 : -0.04, 0);
        target.getChildByName('ForeArm')?.setRotationFromEuler(0, 0, rear ? 68 : 86);
        target.getChildByName('Elbow')?.setPosition(0.5, 0, 0);
        target.getChildByName('Hand')?.setPosition(1.1, rear ? 0.24 : -0.08, 0);
        target.getChildByName('Hand')?.setRotationFromEuler(0, 0, 0);
    }

    private resetLegSegments(target: Node) {
        if (!target) {
            return;
        }
        target.getChildByName('Calf')?.setPosition(0.82, 0.02, 0);
        target.getChildByName('Calf')?.setRotationFromEuler(0, 0, 88);
        target.getChildByName('Knee')?.setPosition(0.54, 0, 0);
        target.getChildByName('Foot')?.setPosition(1.22, 0.02, 0);
        target.getChildByName('Foot')?.setRotationFromEuler(0, 0, 0);
    }

    private restPositionFor(target: Node): Vec3 {
        if (target === this.armNode) {
            return new Vec3(0.55, 0.02, -0.48);
        }
        if (target === this.rearArmNode) {
            return new Vec3(0.05, 0.02, 0.48);
        }
        if (target === this.legNode) {
            return new Vec3(-0.62, -0.02, -0.24);
        }
        return new Vec3(-0.62, -0.02, 0.24);
    }

    private restEulerFor(target: Node): Vec3 {
        if (target === this.armNode) {
            return new Vec3(0, 0, -4);
        }
        if (target === this.rearArmNode) {
            return new Vec3(0, 0, -154);
        }
        if (target === this.legNode) {
            return new Vec3(0, 0, 178);
        }
        return new Vec3(0, 0, 184);
    }

    private captureStartPosition() {
        if (this._hasStartPosition) {
            return;
        }
        this._startPosition = this.node.position.clone();
        this._hasStartPosition = true;
    }

    get currentSpeed(): number {
        return this._currentSpeed;
    }

    get distance(): number {
        return this._distance;
    }

    get isRacing(): boolean {
        return this._isRacing;
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

function smoothRange(value: number, start: number, end: number): number {
    if (value <= start) {
        return 0;
    }
    if (value >= end) {
        return 1;
    }
    const t = (value - start) / (end - start);
    return t * t * (3 - 2 * t);
}
