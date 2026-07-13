import { Node, Quat, Vec3 } from 'cc';
import { CHARACTER_POSE_TUNING } from './CharacterMotionTuning';
import { MOTION_TUNING } from '../core/InputTuning';
import { FreestylePoseController, ProceduralPoseSnapshot } from './FreestylePoseController';
import { findSampledDebugAction } from './SampledActionMotionCurve';
import type { SampledActionId, SampledActionMotion } from './SampledActionMotionCurve';

export enum CharacterPoseState {
    Preview = 'preview',
    ShowcaseStanding = 'showcase-standing',
    DiveReady = 'dive-ready',
    DiveFlight = 'dive-flight',
    Glide = 'glide',
    Freestyle = 'freestyle',
    TreadWater = 'tread-water',
}

export type CharacterPoseStateControllerOptions = {
    pose: FreestylePoseController;
    getModel: () => Node | null;
    getRoot: () => Node | null;
    getSelfTime: () => number;
    updateSplashSurface: (speed: number) => void;
    setSplashVisible: (visible: boolean) => void;
    raceModelYOffset: () => number;
    raceModelEulerDegrees: () => readonly [number, number, number];
};

type ModelTransformSnapshot = {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
};

type PoseTransition = {
    fromPose: ProceduralPoseSnapshot;
    toPose: ProceduralPoseSnapshot;
    fromModel: ModelTransformSnapshot;
    toModel: ModelTransformSnapshot;
    elapsed: number;
    duration: number;
};

export class CharacterPoseStateController {
    private _state = CharacterPoseState.Preview;
    private _diveTransitionElapsed = 0;
    private _diveTransitionDuration = CHARACTER_POSE_TUNING.diveStreamlineTransitionSeconds;
    private _treadWaterStartTime = 0;
    private _showcaseStartTime = 0;
    private _showcaseAction: SampledActionMotion | null = findSampledDebugAction('waving');
    private _poseTransition: PoseTransition | null = null;
    private readonly _transitionPosition = new Vec3();
    private readonly _transitionRotation = new Quat();
    private readonly _transitionScale = new Vec3();

    constructor(private readonly _options: CharacterPoseStateControllerOptions) {}

    get state(): CharacterPoseState {
        return this._state;
    }

    get isFreestyleActive(): boolean {
        return this._state === CharacterPoseState.Freestyle || this._state === CharacterPoseState.Glide;
    }

    setShowcaseAction(actionId: SampledActionId): boolean {
        const action = findSampledDebugAction(actionId);
        if (!action) {
            return false;
        }
        this._showcaseAction = action;
        return true;
    }

    enterPreview() {
        this.setState(CharacterPoseState.Preview);
    }

    enterShowcaseStanding(transitionSeconds = 0) {
        this._showcaseStartTime = this._options.getSelfTime();
        this.transitionTo(CharacterPoseState.ShowcaseStanding, transitionSeconds);
    }

    enterDiveReady(transitionSeconds = 0) {
        this.transitionTo(CharacterPoseState.DiveReady, transitionSeconds);
    }

    enterDiveFlight(duration = CHARACTER_POSE_TUNING.diveStreamlineTransitionSeconds) {
        this._diveTransitionDuration = Math.max(0.01, duration);
        this._diveTransitionElapsed = 0;
        this.setState(CharacterPoseState.DiveFlight);
    }

    enterGlide() {
        this.setState(CharacterPoseState.Glide);
    }

    enterFreestyle() {
        this.setState(CharacterPoseState.Freestyle);
    }

    enterTreadWater() {
        this._treadWaterStartTime = this._options.getSelfTime();
        this.setState(CharacterPoseState.TreadWater);
    }

    reset() {
        this._diveTransitionElapsed = 0;
        this._treadWaterStartTime = 0;
        this._showcaseStartTime = 0;
        this._state = CharacterPoseState.Preview;
        this._poseTransition = null;
    }

    resetRuntime() {
        this._diveTransitionElapsed = 0;
        this._treadWaterStartTime = 0;
        this._poseTransition = null;
    }

    reapplyCurrentState() {
        this.applyStateSetup(this._state);
    }

    update(dt: number, hasAnimation: boolean): boolean {
        if (this._poseTransition) {
            this.updatePoseTransition(dt);
            return true;
        }
        if (this._state === CharacterPoseState.DiveFlight) {
            this.updateDiveFlight(dt);
            return true;
        }
        if (this._state === CharacterPoseState.ShowcaseStanding) {
            this.updateShowcaseStanding();
            return true;
        }
        if (this._state === CharacterPoseState.TreadWater) {
            this.updateTreadWater();
            return true;
        }
        if (this._state === CharacterPoseState.Preview && !hasAnimation) {
            this._options.pose.applyPreviewPose(this._options.getSelfTime());
        }
        return false;
    }

    private setState(state: CharacterPoseState) {
        this._poseTransition = null;
        this._state = state;
        this.applyStateSetup(state);
    }

    transitionTo(state: CharacterPoseState, transitionSeconds: number) {
        const duration = Math.max(0, transitionSeconds);
        const model = this._options.getModel();
        if (duration <= 0 || !model || !this._options.getRoot()) {
            this.setState(state);
            return;
        }
        if (state === this._state && !this._poseTransition) {
            return;
        }

        const fromPose = this._options.pose.capturePoseSnapshot();
        const fromModel = captureModelTransform(model);
        if (!fromPose) {
            this.setState(state);
            return;
        }

        this._state = state;
        this.applyStateSetup(state);
        const toPose = this._options.pose.capturePoseSnapshot();
        const toModel = captureModelTransform(model);
        if (!toPose) {
            this._poseTransition = null;
            return;
        }

        this._options.pose.applyPoseSnapshot(fromPose);
        applyModelTransform(model, fromModel);
        this._poseTransition = {
            fromPose,
            toPose,
            fromModel,
            toModel,
            elapsed: 0,
            duration,
        };
    }

    private updatePoseTransition(dt: number) {
        const transition = this._poseTransition;
        const model = this._options.getModel();
        if (!transition || !model) {
            this._poseTransition = null;
            return;
        }
        transition.elapsed += Math.max(0, dt);
        const ratio = Math.min(1, transition.elapsed / transition.duration);
        const eased = smoothStep(ratio);
        Vec3.lerp(this._transitionPosition, transition.fromModel.position, transition.toModel.position, eased);
        Quat.slerp(this._transitionRotation, transition.fromModel.rotation, transition.toModel.rotation, eased);
        Vec3.lerp(this._transitionScale, transition.fromModel.scale, transition.toModel.scale, eased);
        model.setPosition(this._transitionPosition);
        model.setRotation(this._transitionRotation);
        model.setScale(this._transitionScale);
        this._options.pose.blendPoseSnapshots(transition.fromPose, transition.toPose, eased);
        if (ratio >= 1) {
            this._poseTransition = null;
        }
    }

    private applyStateSetup(state: CharacterPoseState) {
        switch (state) {
            case CharacterPoseState.ShowcaseStanding:
                this.applyShowcaseStandingSetup();
                break;
            case CharacterPoseState.DiveReady:
                this.applyDiveReadySetup();
                break;
            case CharacterPoseState.DiveFlight:
                this.applyDiveFlightSetup();
                break;
            case CharacterPoseState.Glide:
                this.applyGlideSetup();
                break;
            case CharacterPoseState.Freestyle:
                this.applyRaceModelSetup();
                break;
            case CharacterPoseState.TreadWater:
                this.applyTreadWaterSetup();
                break;
            case CharacterPoseState.Preview:
            default:
                break;
        }
    }

    applyRaceModelSetup() {
        const model = this._options.getModel();
        if (!model) {
            return;
        }
        model.setPosition(0, CHARACTER_POSE_TUNING.raceModelBaseY + this._options.raceModelYOffset() + MOTION_TUNING.swimBodyYOffset, 0);
        model.setScale(CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale);
        const euler = this._options.raceModelEulerDegrees();
        model.setRotationFromEuler(euler[0], euler[1], euler[2]);
    }

    private applyDiveReadySetup() {
        if (!this._options.getRoot()) {
            return;
        }
        this.applyDivePrepModelSetup();
        this._options.pose.applyDivePrepPose(1);
        this._options.updateSplashSurface(0);
        this._options.setSplashVisible(false);
    }

    private applyShowcaseStandingSetup() {
        if (!this._options.getRoot()) {
            return;
        }
        this.applyShowcaseStandingModelSetup();
        this.applyShowcasePose(0);
        this._options.updateSplashSurface(0);
        this._options.setSplashVisible(false);
    }

    private applyDiveFlightSetup() {
        if (!this._options.getRoot()) {
            return;
        }
        this.applyDivePrepModelSetup();
        this._options.pose.applyDivePrepToStreamlinePose(0);
        this._options.setSplashVisible(false);
    }

    private applyGlideSetup() {
        if (!this._options.getRoot()) {
            return;
        }
        this.applyRaceModelSetup();
        this._options.pose.restoreBasePose();
        this._options.pose.applyFreestylePose(0, 0, 0, 0, 0, 1, 1, 0.9);
        this._options.setSplashVisible(false);
    }

    private updateDiveFlight(dt: number) {
        const model = this._options.getModel();
        if (!model || !this._options.getRoot()) {
            return;
        }
        this._diveTransitionElapsed += dt;
        const t = Math.min(1, this._diveTransitionElapsed / this._diveTransitionDuration);
        const eased = smoothStep(t);
        const prepWeight = 1 - eased;
        const raceY = CHARACTER_POSE_TUNING.raceModelBaseY + this._options.raceModelYOffset() + MOTION_TUNING.swimBodyYOffset;
        model.setPosition(CHARACTER_POSE_TUNING.divePrepModelBackOffset * prepWeight, lerp(raceY, CHARACTER_POSE_TUNING.divePrepModelY, prepWeight), 0);
        model.setScale(CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale);
        const euler = this._options.raceModelEulerDegrees();
        model.setRotationFromEuler(
            lerp(euler[0], CHARACTER_POSE_TUNING.divePrepModelEuler[0], prepWeight),
            lerp(euler[1], CHARACTER_POSE_TUNING.divePrepModelEuler[1], prepWeight),
            lerp(euler[2], CHARACTER_POSE_TUNING.divePrepModelEuler[2], prepWeight),
        );
        this._options.pose.applyDivePrepToStreamlinePose(eased);
        this._options.updateSplashSurface(0);
        this._options.setSplashVisible(false);
        if (t >= 1) {
            this.enterGlide();
        }
    }

    private applyTreadWaterSetup() {
        const model = this._options.getModel();
        if (!model || !this._options.getRoot()) {
            return;
        }
        model.setPosition(0, CHARACTER_POSE_TUNING.finishFloatBaseY, 0);
        model.setScale(CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale);
        model.setRotationFromEuler(0, 90, 0);
        this.applyTreadWaterPose();
        this._options.updateSplashSurface(0);
        this._options.setSplashVisible(false);
    }

    private applyDivePrepModelSetup() {
        const model = this._options.getModel();
        if (!model) {
            return;
        }
        model.setPosition(CHARACTER_POSE_TUNING.divePrepModelBackOffset, CHARACTER_POSE_TUNING.divePrepModelY, 0);
        model.setScale(CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale);
        model.setRotationFromEuler(CHARACTER_POSE_TUNING.divePrepModelEuler[0], CHARACTER_POSE_TUNING.divePrepModelEuler[1], CHARACTER_POSE_TUNING.divePrepModelEuler[2]);
    }

    private applyShowcaseStandingModelSetup() {
        const model = this._options.getModel();
        if (!model) {
            return;
        }
        model.setPosition(CHARACTER_POSE_TUNING.divePrepModelBackOffset, CHARACTER_POSE_TUNING.showcaseStandingModelY, 0);
        model.setScale(CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale, CHARACTER_POSE_TUNING.modelScale);
        model.setRotationFromEuler(CHARACTER_POSE_TUNING.divePrepModelEuler[0], CHARACTER_POSE_TUNING.divePrepModelEuler[1], CHARACTER_POSE_TUNING.divePrepModelEuler[2]);
    }

    private updateTreadWater() {
        const model = this._options.getModel();
        if (!model || !this._options.getRoot()) {
            return;
        }
        const bob = Math.sin(this._options.getSelfTime() * CHARACTER_POSE_TUNING.finishFloatBobSpeed) * CHARACTER_POSE_TUNING.finishFloatBobAmplitude;
        model.setPosition(0, CHARACTER_POSE_TUNING.finishFloatBaseY + bob, 0);
        this.applyTreadWaterPose();
    }

    private updateShowcaseStanding() {
        const elapsed = Math.max(0, this._options.getSelfTime() - this._showcaseStartTime);
        const phase = this._showcaseAction
            ? positiveMod(elapsed / Math.max(0.1, this._showcaseAction.durationSeconds), 1)
            : 0;
        this.applyShowcasePose(phase);
        this._options.updateSplashSurface(0);
        this._options.setSplashVisible(false);
    }

    private applyShowcasePose(phase: number) {
        if (this._showcaseAction) {
            this._options.pose.applySampledActionPose(this._showcaseAction.id, phase, 1);
            return;
        }
        this._options.pose.applyPreRaceStandingPose();
    }

    private applyTreadWaterPose() {
        const elapsed = Math.max(0, this._options.getSelfTime() - this._treadWaterStartTime);
        const cycleSeconds = CHARACTER_POSE_TUNING.finishTreadWaterCycleSeconds;
        const phase = positiveMod(elapsed / cycleSeconds, 1);
        this._options.pose.setMovementDirection(1);
        this._options.pose.applyBreaststrokePose(phase, 1);
    }
}

function positiveMod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function smoothStep(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * Math.max(0, Math.min(1, t));
}

function captureModelTransform(model: Node): ModelTransformSnapshot {
    return {
        position: model.position.clone(),
        rotation: Quat.clone(model.rotation),
        scale: model.scale.clone(),
    };
}

function applyModelTransform(model: Node, transform: ModelTransformSnapshot) {
    model.setPosition(transform.position);
    model.setRotation(transform.rotation);
    model.setScale(transform.scale);
}
