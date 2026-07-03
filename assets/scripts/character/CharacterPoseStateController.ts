import { Node } from 'cc';
import { CHARACTER_POSE_TUNING } from './CharacterMotionTuning';
import { MOTION_TUNING } from '../core/InputTuning';
import { FreestylePoseController } from './FreestylePoseController';

export enum CharacterPoseState {
    Preview = 'preview',
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

export class CharacterPoseStateController {
    private _state = CharacterPoseState.Preview;
    private _diveTransitionElapsed = 0;
    private _diveTransitionDuration = CHARACTER_POSE_TUNING.diveStreamlineTransitionSeconds;
    private _treadWaterStartTime = 0;

    constructor(private readonly _options: CharacterPoseStateControllerOptions) {}

    get state(): CharacterPoseState {
        return this._state;
    }

    get isFreestyleActive(): boolean {
        return this._state === CharacterPoseState.Freestyle || this._state === CharacterPoseState.Glide;
    }

    enterPreview() {
        this.setState(CharacterPoseState.Preview);
    }

    enterDiveReady() {
        this.setState(CharacterPoseState.DiveReady);
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
        this._state = CharacterPoseState.Preview;
    }

    resetRuntime() {
        this._diveTransitionElapsed = 0;
        this._treadWaterStartTime = 0;
    }

    reapplyCurrentState() {
        this.applyStateSetup(this._state);
    }

    update(dt: number, hasAnimation: boolean): boolean {
        if (this._state === CharacterPoseState.DiveFlight) {
            this.updateDiveFlight(dt);
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
        this._state = state;
        this.applyStateSetup(state);
    }

    private applyStateSetup(state: CharacterPoseState) {
        switch (state) {
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

    private updateTreadWater() {
        const model = this._options.getModel();
        if (!model || !this._options.getRoot()) {
            return;
        }
        const bob = Math.sin(this._options.getSelfTime() * CHARACTER_POSE_TUNING.finishFloatBobSpeed) * CHARACTER_POSE_TUNING.finishFloatBobAmplitude;
        model.setPosition(0, CHARACTER_POSE_TUNING.finishFloatBaseY + bob, 0);
        this.applyTreadWaterPose();
    }

    private applyTreadWaterPose() {
        const elapsed = Math.max(0, this._options.getSelfTime() - this._treadWaterStartTime);
        const cycleSeconds = CHARACTER_POSE_TUNING.finishTreadWaterCycleSeconds / Math.max(0.25, MOTION_TUNING.animationSpeedScale);
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
