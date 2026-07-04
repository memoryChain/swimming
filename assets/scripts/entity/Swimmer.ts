import { _decorator, Component, Node, Tween, Vec3, tween } from 'cc';
import { SWIMMER_ACTION_TUNING } from '../character/CharacterMotionTuning';
import {
    Rating,
    StrokeType,
} from '../core/GameConstants';
import { DIVE_BALANCE, SWIMMER_BALANCE, getRaceDistance } from '../core/GameBalance';
import type { RhythmResult, RhythmStats } from '../core/RhythmTypes';
import { DiveEntryStyle, DiveResult } from '../core/DiveResult';
import { StrokeMetrics } from '../swimmer/StrokeMetrics';
import { StrokeConditionInput } from '../condition/ConditionTypes';
import { ratingForStability, rhythmResultFromStability } from '../core/StabilityScoring';
import { StrokeStabilityResult, StrokeTimingGuide, SwimmerMotor } from '../swimmer/SwimmerMotor';
import { DEFAULT_RACE_COURSE_LAYOUT, RaceCourseLayout } from '../venue/RaceCourseLayout';
import { CartoonSwimmerRig } from './CartoonSwimmerRig';

const { ccclass, property } = _decorator;

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
    @property public isAI = false;
    @property public aiPower = 1;
    @property public aiMaxSpeedScale = 1;
    @property public swimmerName = 'Swimmer';

    private readonly _motor = new SwimmerMotor();
    private _startPosition = new Vec3();
    private _hasStartPosition = false;
    private _stabilityCombo = 0;
    private _maxStabilityCombo = 0;
    private _perfectStabilityCount = 0;
    private _goodStabilityCount = 0;
    private _missStabilityCount = 0;
    private readonly _pendingRhythmResults: RhythmResult[] = [];
    private readonly _strokeMetrics = new StrokeMetrics();
    private readonly _pendingConditionInputs: StrokeConditionInput[] = [];
    private _modelBaseRootEuler = new Vec3(90, 0, -90);
    private _modelBaseRootPos = new Vec3(0, 0.1, 0);
    private _boneBaseEuler = new Map<Node, Vec3>();
    private _courseLayout: RaceCourseLayout = DEFAULT_RACE_COURSE_LAYOUT;
    private _diveUnderwaterActive = false;
    private _diveGlidePoseActive = false;
    private _diveUnderwaterElapsed = 0;
    private _diveEntryLeanDegrees = 0;
    private readonly _cameraUpperBodyA = new Vec3();
    private readonly _cameraUpperBodyB = new Vec3();

    start() {
        this.captureStartPosition();
    }

    configureCourse(courseLayout: RaceCourseLayout) {
        this._courseLayout = courseLayout;
        this._startPosition = this._courseLayout.swimPosition(0, this.node.position.z);
        this._hasStartPosition = true;
        this.node.setPosition(this._startPosition);
        this.cartoonRig?.setWaterY(this._courseLayout.waterY);
    }

    startRace(initialDistance = 0, initialSpeed = SWIMMER_BALANCE.baseSpeed, fromDiveEntry = false) {
        this.captureStartPosition();
        if (fromDiveEntry) {
            this.startDiveUnderwaterPhase(initialDistance);
        } else {
            this.clearDiveUnderwaterPhase();
        }
        const maxSpeed = SWIMMER_BALANCE.maxSpeed * (this.isAI ? this.aiMaxSpeedScale : 1);
        const initialSpeedCapBonus = Math.max(0, initialSpeed - maxSpeed);
        this._motor.startRace(initialDistance, initialSpeed, initialSpeedCapBonus);
        this.applyCoursePosition(initialDistance);
        this.cartoonRig?.setPreRaceStanding(false);
        if (fromDiveEntry) {
            if (this.cartoonRig) {
                this.cartoonRig.setDiveStreamlinePose();
            } else {
                this.resetPose();
            }
        } else {
            this.resetPose();
            this.cartoonRig?.setActiveSwimming(true);
        }
    }

    prepareDive() {
        this.captureStartPosition();
        Tween.stopAllByTarget(this.node);
        this._motor.reset();
        this.clearDiveUnderwaterPhase();
        this.node.setPosition(this.divePlatformPosition());
        this.node.setRotationFromEuler(0, this._courseLayout.direction > 0 ? 0 : 180, 0);
        this.resetPose();
        this.cartoonRig?.setActiveSwimming(false);
        this.cartoonRig?.setPreRaceStanding(true);
    }

    performDive(result: DiveResult): number {
        this.captureStartPosition();
        const divePower = result.power;
        const launchSpeed = result.launchSpeed;
        const crouchDuration = lerp(SWIMMER_ACTION_TUNING.diveCrouchSecondsMax, SWIMMER_ACTION_TUNING.diveCrouchSecondsMin, divePower);
        const direction = this._courseLayout.direction;
        const start = this.divePlatformPosition();
        const launchStart = new Vec3(
            start.x - SWIMMER_ACTION_TUNING.diveCrouchBackOffset * direction,
            start.y - SWIMMER_ACTION_TUNING.diveCrouchDrop,
            start.z,
        );
        const entryY = this._courseLayout.swimY - SWIMMER_ACTION_TUNING.diveEntryDepth;
        const launchAngle = degreesToRadians(DIVE_BALANCE.launchAngleDegrees);
        const horizontalSpeed = launchSpeed * Math.cos(launchAngle);
        const verticalSpeed = launchSpeed * Math.sin(launchAngle);
        const projectileFlightDuration = projectileTimeToY(launchStart.y, entryY, verticalSpeed, DIVE_BALANCE.launchGravity);
        const distance = horizontalSpeed * projectileFlightDuration;
        const entry = this._courseLayout.entryPosition(distance, this._startPosition.z);
        entry.y = entryY;
        const poseTransitionDuration = projectileFlightDuration * SWIMMER_ACTION_TUNING.diveExtensionRatio;
        const launchDelayDuration = poseTransitionDuration * SWIMMER_ACTION_TUNING.diveLaunchDelayRatio;
        const totalDuration = crouchDuration + launchDelayDuration + projectileFlightDuration;

        Tween.stopAllByTarget(this.node);
        this.node.setPosition(start);
        this.node.setRotationFromEuler(0, direction > 0 ? 0 : 180, 0);
        this.cartoonRig?.setPreRaceStanding(true);
        tween(this.node)
            .to(crouchDuration, {
                position: launchStart,
                eulerAngles: new Vec3(0, direction > 0 ? 0 : 180, -5),
            }, { easing: 'quadIn' })
            .call(() => {
                this.cartoonRig?.startDiveStreamlineTransition(poseTransitionDuration);
            })
            .delay(launchDelayDuration)
            .to(projectileFlightDuration, {}, {
                onUpdate: (_target?: Node, ratio = 0) => {
                    this.applyDiveProjectile(launchStart, horizontalSpeed, verticalSpeed, DIVE_BALANCE.launchGravity, direction, ratio, projectileFlightDuration);
                },
            })
            .call(() => {
                this._diveEntryLeanDegrees = this.diveProjectileLean(horizontalSpeed, verticalSpeed, DIVE_BALANCE.launchGravity, projectileFlightDuration);
                this.applyDiveProjectile(launchStart, horizontalSpeed, verticalSpeed, DIVE_BALANCE.launchGravity, direction, 1, projectileFlightDuration);
                this.cartoonRig?.setDiveStreamlinePose();
                this.startRace(distance, horizontalSpeed, true);
                this.flashSplash(splashRatingForEntryStyle(result.entryStyle));
            })
            .start();

        return totalDuration;
    }

    private applyDiveProjectile(start: Vec3, horizontalSpeed: number, verticalSpeed: number, gravity: number, direction: number, ratio: number, duration: number) {
        const t = Math.max(0, Math.min(1, ratio));
        const seconds = duration * t;
        const x = start.x + horizontalSpeed * seconds * direction;
        const y = start.y + verticalSpeed * seconds - gravity * seconds * seconds * 0.5;
        const lean = this.diveProjectileLean(horizontalSpeed, verticalSpeed, gravity, seconds);
        this.node.setPosition(x, y, start.z);
        this.node.setRotationFromEuler(0, direction > 0 ? 0 : 180, lean);
    }

    private diveProjectileLean(horizontalSpeed: number, verticalSpeed: number, gravity: number, seconds: number): number {
        return radiansToDegrees(Math.atan2(verticalSpeed - gravity * seconds, horizontalSpeed));
    }

    stopRace() {
        Tween.stopAllByTarget(this.node);
        this._motor.stopRace();
        this.clearDiveUnderwaterPhase();
        this.cartoonRig?.setActiveSwimming(false);
    }

    update(dt: number) {
        if (!this._motor.isRacing) {
            return;
        }

        const finished = this._motor.update(dt, {
            isAI: this.isAI,
            aiPower: this.aiPower,
            aiMaxSpeedScale: this.aiMaxSpeedScale,
        });
        if (!this.isAI) {
            this._strokeMetrics.update(dt);
        }
        this.updateDiveUnderwaterTimer(dt);
        this.applyCoursePosition(this._motor.distance);
        this.updateBodyMotion(dt);
        for (const stability of this._motor.consumeStabilityResults()) {
            const result = this.makeStabilityResult(stability.type, stability);
            if (result) {
                this._pendingRhythmResults.push(result);
                this.flashSplash(result.rating);
            }
        }

        if (finished) {
            this.node.emit('swimmer-finished', this);
        }
    }

    handleStroke(type: StrokeType): RhythmResult | null {
        if (!this._motor.isRacing) {
            return null;
        }
        if (this._diveGlidePoseActive) {
            if (this._motor.recordKickOnly(type)) {
                this.cartoonRig?.triggerKick();
            }
            return null;
        }

        const queued = this._motor.recordStroke(type);
        if (!queued) {
            return null;
        }
        this._strokeMetrics.recordStroke(type);
        this.playStroke(type, Rating.GOOD);
        return null;
    }

    canAcceptStroke(type: StrokeType): boolean {
        return this._motor.isRacing && (this._diveGlidePoseActive || this._motor.canRecordStroke(type));
    }

    handleStrokeHeld(type: StrokeType, held: boolean): RhythmResult | null {
        if (this._diveGlidePoseActive) {
            return null;
        }
        const stability = this._motor.setStrokeHeld(type, held);
        this.cartoonRig?.setStrokeHeld(type, held);
        if (held) {
            this._strokeMetrics.recordStroke(type);
        }
        return held ? null : this.makeStabilityResult(type, stability);
    }

    setSplashCulled(culled: boolean) {
        this.cartoonRig?.setSplashCulled(culled);
    }

    setMotionThrottleStride(stride: number) {
        this.cartoonRig?.setMotionThrottleStride(stride);
    }

    setSplashParticlesEnabled(enabled: boolean) {
        this.cartoonRig?.setSplashParticlesEnabled(enabled);
    }

    playAiStrokeVisual(type: StrokeType) {
        if (!this.isAI) {
            return;
        }
        if (this._diveGlidePoseActive) {
            if (this._motor.recordKickOnly(type)) {
                this.cartoonRig?.triggerKick();
            }
            return;
        }
        if (this._motor.recordAiVisualStroke(type)) {
            this.cartoonRig?.triggerStroke(type);
        }
    }

    playPerfectFlash() {
        if (!this.isAI) {
            this.cartoonRig?.triggerPerfectGlow();
        }
    }

    playFinishRagdoll() {
        this.playFinishTouch();
    }

    playFinishTouch() {
        const finishPosition = this.node.position.clone();
        const direction = this._courseLayout.finishDirectionAtDistance(getRaceDistance());
        const inwardDirection = -direction;
        Tween.stopAllByTarget(this.node);
        this._motor.stopRace();
        if (this.cartoonRig) {
            this.node.setRotationFromEuler(0, inwardDirection > 0 ? 0 : 180, 0);
            this.cartoonRig.setFinishFloating();
            const x = this.finishFloatX(direction);
            this.node.setPosition(x, finishPosition.y + 0.01, finishPosition.z);
            return;
        }
        this.node.setRotationFromEuler(0, inwardDirection > 0 ? 0 : 180, 0);
        tween(this.node)
            .to(0.12, { eulerAngles: new Vec3(0, inwardDirection > 0 ? 0 : 180, -5), position: new Vec3(this._courseLayout.clampSwimWorldX(finishPosition.x - 0.08 * direction), finishPosition.y, finishPosition.z) })
            .to(0.16, { eulerAngles: new Vec3(0, inwardDirection > 0 ? 0 : 180, 6), position: new Vec3(this.finishFloatX(direction), finishPosition.y - 0.05, finishPosition.z) })
            .to(0.18, { eulerAngles: new Vec3(0, inwardDirection > 0 ? 0 : 180, 0) })
            .start();
    }

    reset() {
        this.captureStartPosition();
        Tween.stopAllByTarget(this.node);
        this._motor.reset();
        this.clearDiveUnderwaterPhase();
        this._stabilityCombo = 0;
        this._maxStabilityCombo = 0;
        this._perfectStabilityCount = 0;
        this._goodStabilityCount = 0;
        this._missStabilityCount = 0;
        this._pendingRhythmResults.length = 0;
        this._pendingConditionInputs.length = 0;
        this._strokeMetrics.reset();
        this.node.setPosition(this.divePlatformPosition());
        this.node.setRotationFromEuler(0, this._courseLayout.direction > 0 ? 0 : 180, 0);
        this.resetPose();
        this.cartoonRig?.setActiveSwimming(false);
        this.cartoonRig?.setPreRaceStanding(true);
    }

    private playStroke(type: StrokeType, rating: Rating) {
        const powerScale = rating === Rating.PERFECT ? 1.18 : rating === Rating.BAD ? 0.72 : 1;
        this.cartoonRig?.triggerStroke(type);
        if (type === StrokeType.LEFT) {
            this.pulseModel(-8, 0.16 / powerScale);
            this.freestyleArmPull(this.armNode, new Vec3(0.64, 0.08, -0.52), -4, new Vec3(-0.1, -0.03, -0.5), -150, 0.26 / powerScale);
            this.flutterKick(this.rearLegNode, new Vec3(-1.02, 0.18, 0.25), 198, 0.12 / powerScale);
        } else if (type === StrokeType.RIGHT) {
            this.pulseModel(8, 0.16 / powerScale);
            this.freestyleArmPull(this.rearArmNode, new Vec3(0.12, 0.2, 0.52), 42, new Vec3(0.7, 0.12, 0.52), -2, 0.28 / powerScale);
            this.flutterKick(this.legNode, new Vec3(-1.02, -0.08, -0.25), 164, 0.12 / powerScale);
        } else {
            this.pulseModel(0, 0.16 / powerScale);
            this.freestyleArmPull(this.armNode, new Vec3(0.64, 0.08, -0.52), -4, new Vec3(-0.1, -0.03, -0.5), -150, 0.26 / powerScale);
            this.freestyleArmPull(this.rearArmNode, new Vec3(0.12, 0.2, 0.52), 42, new Vec3(0.7, 0.12, 0.52), -2, 0.28 / powerScale);
            this.flutterKick(this.legNode, new Vec3(-1.02, -0.08, -0.25), 164, 0.12 / powerScale);
            this.flutterKick(this.rearLegNode, new Vec3(-1.02, 0.18, 0.25), 198, 0.12 / powerScale);
        }
        this.flashSplash(rating);
    }

    private makeStabilityResult(type: StrokeType, stability: StrokeStabilityResult | null): RhythmResult | null {
        if (!stability) {
            return null;
        }
        const rating = ratingForStability(stability.stability);
        if (rating === Rating.PERFECT) {
            this._stabilityCombo += 1;
            this._perfectStabilityCount += 1;
        } else if (rating === Rating.GOOD) {
            this._goodStabilityCount += 1;
        } else {
            this._stabilityCombo = 0;
            this._missStabilityCount += 1;
        }
        this._maxStabilityCombo = Math.max(this._maxStabilityCombo, this._stabilityCombo);
        if (!this.isAI) {
            this._pendingConditionInputs.push({
                strokeAccepted: true,
                qualityScore: stability.stability,
                pressureScore: this._strokeMetrics.effortScore,
                dt: 0,
            });
        }
        const result = rhythmResultFromStability(stability, this._stabilityCombo);
        if (rating === Rating.PERFECT) {
            const comboSpeedBonus = this._motor.applyPerfectComboBoost(this._stabilityCombo);
            if (comboSpeedBonus > 0) {
                result.comboSpeedBonus = comboSpeedBonus;
            }
        }
        return result;
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
        const bob = Math.sin(this._motor.bodyPhase) * 0.045;
        const sideRoll = sideBodyRollSignal(this._motor.leftArmCycle, this._motor.rightArmCycle);
        if (this.cartoonRig) {
            if (this._diveGlidePoseActive) {
                this.cartoonRig.setLegSplashSuppressed(true);
                this.cartoonRig.updateUnderwaterKickFromMotor(dt, this._motor, this.raceDirection);
            } else {
                this.cartoonRig.setLegSplashSuppressed(false);
                this.cartoonRig.updateFreestyleFromMotor(dt, this._motor, this.raceDirection);
            }
            return;
        }
        this.bodyNode?.setPosition(0, 0.18 + bob, 0);
        this.bodyNode?.setRotationFromEuler(0, sideRoll * 26, 0);
        this.headNode?.setPosition(1.23, 0.28 + bob * 0.45, 0);
        this.applyFreestyleArm(this.armNode, Math.sin(this._motor.leftArmCycle), -0.48, false, 1 + this._motor.armAction * 0.55);
        this.applyFreestyleArm(this.rearArmNode, Math.sin(this._motor.rightArmCycle), 0.48, true, 1 + this._motor.armAction * 0.55);
        this.applyFlutterKick(this.legNode, Math.sin(this._motor.leftKickCycle), -0.24, 1 + this._motor.kickAction * 0.75);
        this.applyFlutterKick(this.rearLegNode, Math.sin(this._motor.rightKickCycle), 0.24, 1 + this._motor.kickAction * 0.75);
    }

    private flashSplash(rating: Rating) {
        if (this.cartoonRig) {
            const scale = rating === Rating.PERFECT ? 1.15 : rating === Rating.BAD ? 0.55 : 0.85;
            this.cartoonRig.triggerSplashBurst(scale);
            return;
        }
        if (!this.splashNode) {
            return;
        }
        const scale = rating === Rating.PERFECT ? 1.45 : rating === Rating.BAD ? 0.75 : 1;
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

        const arm = Math.sin(this._motor.leftArmCycle);
        const armOpposite = Math.sin(this._motor.rightArmCycle);
        const kick = Math.sin(this._motor.leftKickCycle);
        const kickOpposite = Math.sin(this._motor.rightKickCycle);

        this.modelRootNode.setPosition(
            this._modelBaseRootPos.x + Math.sin(this._motor.armCycle) * 0.04,
            this._modelBaseRootPos.y + bob * 0.55,
            this._modelBaseRootPos.z + Math.sin(this._motor.kickCycle) * 0.02,
        );
        this.modelRootNode.setRotationFromEuler(
            this._modelBaseRootEuler.x + Math.sin(this._motor.kickCycle) * 1.5,
            this._modelBaseRootEuler.y + roll * 0.55,
            this._modelBaseRootEuler.z + Math.sin(this._motor.armCycle) * 2.5,
        );

        this.applyBoneOffset(this.modelSpine, 0, roll * 0.45, Math.sin(this._motor.armCycle) * 3);
        this.applyBoneOffset(this.modelHead, -4, roll * 0.2, Math.sin(this._motor.armCycle + 0.8) * 2);

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
        this._startPosition = this._courseLayout.swimPosition(0, this.node.position.z);
        this.node.setPosition(this._startPosition);
        this._hasStartPosition = true;
    }

    private divePlatformPosition(): Vec3 {
        return this._courseLayout.platformStandingPosition(this._startPosition.z);
    }

    private applyCoursePosition(distance: number) {
        const visualDistance = Math.min(distance, getRaceDistance());
        const direction = this._courseLayout.finishDirectionAtDistance(visualDistance);
        const x = this._courseLayout.clampSwimWorldX(this._courseLayout.distanceToWorldX(visualDistance));
        this.node.setPosition(x, this.visualSwimY(visualDistance), this._startPosition.z);
        this.node.setRotationFromEuler(0, direction > 0 ? 0 : 180, this.diveRecoveryLean(visualDistance));
    }

    private finishFloatX(direction: number): number {
        const edgeX = direction > 0 ? this._courseLayout.poolFinishX : this._courseLayout.poolStartX;
        const poolMinX = Math.min(this._courseLayout.poolStartX, this._courseLayout.poolFinishX);
        const poolMaxX = Math.max(this._courseLayout.poolStartX, this._courseLayout.poolFinishX);
        const nearEdgeX = edgeX - direction * SWIMMER_ACTION_TUNING.finishFloatPoolEdgeClearance;
        const swimEdgeX = direction > 0
            ? Math.max(this._courseLayout.startX, this._courseLayout.finishX)
            : Math.min(this._courseLayout.startX, this._courseLayout.finishX);
        const closerThanSwimEdgeX = direction > 0
            ? Math.max(swimEdgeX, nearEdgeX)
            : Math.min(swimEdgeX, nearEdgeX);
        return Math.max(poolMinX, Math.min(poolMaxX, closerThanSwimEdgeX));
    }

    private startDiveUnderwaterPhase(_initialDistance: number) {
        this._diveUnderwaterActive = true;
        this._diveGlidePoseActive = true;
        this._diveUnderwaterElapsed = 0;
        this.cartoonRig?.setLegSplashSuppressed(true);
    }

    private clearDiveUnderwaterPhase() {
        this._diveUnderwaterActive = false;
        this._diveGlidePoseActive = false;
        this._diveUnderwaterElapsed = 0;
        this._diveEntryLeanDegrees = 0;
        this.cartoonRig?.setLegSplashSuppressed(false);
    }

    private beginSurfaceSwimming() {
        this._diveGlidePoseActive = false;
        this.cartoonRig?.setLegSplashSuppressed(false);
        if (this._motor.isRacing) {
            this.cartoonRig?.setActiveSwimming(true);
        }
    }

    private updateDiveUnderwaterTimer(dt: number) {
        if (!this._diveUnderwaterActive) {
            return;
        }
        this._diveUnderwaterElapsed += Math.max(0, dt);
    }

    private visualSwimY(_distance: number): number {
        if (!this._diveUnderwaterActive) {
            return this._startPosition.y;
        }
        const underwaterY = this._courseLayout.swimY - SWIMMER_ACTION_TUNING.diveEntryDepth;
        const holdSeconds = Math.max(0, SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds);
        if (this._diveUnderwaterElapsed <= holdSeconds) {
            return underwaterY;
        }
        const riseSeconds = Math.max(0.01, SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds);
        const ratio = (this._diveUnderwaterElapsed - holdSeconds) / riseSeconds;
        if (ratio >= 1) {
            this.clearDiveUnderwaterPhase();
            this.beginSurfaceSwimming();
            return this._startPosition.y;
        }
        return lerp(underwaterY, this._startPosition.y, smoothStep(ratio));
    }

    private diveRecoveryLean(distance: number): number {
        if (!this._diveUnderwaterActive) {
            return 0;
        }
        const holdSeconds = Math.max(0, SWIMMER_ACTION_TUNING.diveUnderwaterHoldSeconds);
        const riseSeconds = Math.max(0.01, SWIMMER_ACTION_TUNING.diveUnderwaterRiseSeconds);
        const elapsed = this._diveUnderwaterElapsed;
        if (elapsed <= holdSeconds) {
            // Straighten from the head-down entry lean to horizontal early in the hold,
            // so the body does not linger in the diagonal-down pose.
            const straightenSeconds = Math.max(0.01, holdSeconds * SWIMMER_ACTION_TUNING.diveStraightenRatio);
            const ratio = Math.max(0, Math.min(1, elapsed / straightenSeconds));
            return lerp(this._diveEntryLeanDegrees, 0, smoothStep(ratio));
        }
        // Ascent: tilt head-up toward the surface, then level out as it breaks the surface.
        const riseRatio = Math.max(0, Math.min(1, (elapsed - holdSeconds) / riseSeconds));
        return SWIMMER_ACTION_TUNING.diveUnderwaterRiseTiltDegrees * Math.sin(Math.PI * riseRatio);
    }

    get currentSpeed(): number {
        return this._motor.currentSpeed;
    }

    get isUnderwater(): boolean {
        return this._diveUnderwaterActive;
    }

    get currentAcceleration(): number {
        return this._motor.currentAcceleration;
    }

    get currentStability(): number {
        return this._motor.lastStability;
    }

    // Sustained limb effort (0..1), used by the flow layer to read sprint intent.
    get effortScore(): number {
        return this._strokeMetrics.effortScore;
    }

    get swimWorldY(): number {
        return this._courseLayout.swimY;
    }

    get waterWorldY(): number {
        return this._courseLayout.waterY;
    }

    get actionCycleSeconds(): number {
        return this._motor.actionCycleSeconds;
    }

    get strokeTimingGuide(): StrokeTimingGuide {
        return this._motor.strokeTimingGuide;
    }

    get distance(): number {
        return this._motor.distance;
    }

    get raceDirection(): number {
        return this._courseLayout.directionAtDistance(this._motor.distance);
    }

    getCameraUpperBodyWorldPosition(out: Vec3): Vec3 {
        if (this.cartoonRig?.getUpperBodyWorldPosition(out)) {
            return out;
        }
        if (this.modelSpine?.isValid && this.modelHead?.isValid) {
            this.modelSpine.getWorldPosition(this._cameraUpperBodyA);
            this.modelHead.getWorldPosition(this._cameraUpperBodyB);
            Vec3.lerp(out, this._cameraUpperBodyA, this._cameraUpperBodyB, 0.42);
            return out;
        }
        if (this.modelSpine?.isValid) {
            this.modelSpine.getWorldPosition(out);
            return out;
        }
        if (this.bodyNode?.isValid && this.headNode?.isValid) {
            this.bodyNode.getWorldPosition(this._cameraUpperBodyA);
            this.headNode.getWorldPosition(this._cameraUpperBodyB);
            Vec3.lerp(out, this._cameraUpperBodyA, this._cameraUpperBodyB, 0.55);
            return out;
        }
        out.set(this.node.worldPosition);
        out.y += 0.54;
        return out;
    }

    get isRacing(): boolean {
        return this._motor.isRacing;
    }

    get rhythmStats(): RhythmStats {
        return {
            maxCombo: this._maxStabilityCombo,
            perfectCount: this._perfectStabilityCount,
            goodCount: this._goodStabilityCount,
            missCount: this._missStabilityCount,
        };
    }

    applyConditionSpeedScale(scale: number) {
        this._motor.setConditionSpeedScale(scale);
    }

    applyConditionQualityScale(scale: number) {
        this._motor.setConditionQualityScale(scale);
    }

    consumeConditionInputs(): StrokeConditionInput[] {
        if (this._pendingConditionInputs.length === 0) {
            return [];
        }
        return this._pendingConditionInputs.splice(0);
    }

    consumeRhythmResults(): RhythmResult[] {
        if (this._pendingRhythmResults.length === 0) {
            return [];
        }
        return this._pendingRhythmResults.splice(0);
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function degreesToRadians(degrees: number): number {
    return degrees * Math.PI / 180;
}

function radiansToDegrees(radians: number): number {
    return radians * 180 / Math.PI;
}

function projectileTimeToY(startY: number, targetY: number, initialVerticalSpeed: number, gravity: number): number {
    const drop = startY - targetY;
    const safeGravity = Math.max(0.01, gravity);
    return Math.max(0.01, (initialVerticalSpeed + Math.sqrt(initialVerticalSpeed * initialVerticalSpeed + 2 * safeGravity * drop)) / safeGravity);
}

function splashRatingForEntryStyle(style: DiveEntryStyle): Rating {
    if (style === DiveEntryStyle.CLEAN) {
        return Rating.PERFECT;
    }
    if (style === DiveEntryStyle.NORMAL) {
        return Rating.GOOD;
    }
    return Rating.BAD;
}

function sideBodyRollSignal(leftCycle: number, rightCycle: number): number {
    const leftReach = Math.cos(positiveMod(-leftCycle, Math.PI * 2));
    const rightReach = Math.cos(positiveMod(-rightCycle, Math.PI * 2));
    return (leftReach - rightReach) * 0.5;
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function smoothStep(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}
