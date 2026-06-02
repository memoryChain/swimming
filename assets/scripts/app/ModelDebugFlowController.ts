import { Camera, Color, EventMouse, Label, Node, Vec3 } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { SWIMMER_BALANCE } from '../core/GameBalance';
import { GameState, Rating, StrokeType } from '../core/GameConstants';
import { InputManager } from '../core/InputManager';
import { MOTION_TUNING } from '../core/InputTuning';
import { RaceManager } from '../core/RaceManager';
import { RhythmResult } from '../core/RhythmEvaluator';
import { SwimmerMotor } from '../swimmer/SwimmerMotor';
import { UIFlowController } from '../ui/UIFlowController';

export type ModelDebugFlowRefs = {
    cameraNode: Node | null;
    cameraPos: Vec3;
    cameraTarget: Vec3;
    playerLaneZ: number;
    inputManager: InputManager | null;
    raceManager: RaceManager | null;
    raceCameraDirector: RaceCameraDirector;
    playerSwimmer: Swimmer | null;
    aiSwimmers: Swimmer[];
    aiControllers: AISwimmerController[];
    uiFlow: UIFlowController;
    speedLabel: Label | null;
    ratingLabel: Label | null;
    swimSpeedLabel: Label | null;
    resetExtraAiSwimmers: () => void;
    showStartScreen: () => void;
    setState: (state: GameState) => void;
    debug: (message: string) => void;
};

export class ModelDebugFlowController {
    private _active = false;
    private _cameraDragging = false;
    private _cameraYaw = Math.PI / 2;
    private _cameraPitch = 0.04;
    private _cameraDistance = 3.2;
    private _speedScale = MOTION_TUNING.animationSpeedScale;
    private readonly _debugMotor = new SwimmerMotor();
    private _debugRhythmBonus = 0;
    private _lastRating: Rating | null = null;
    private _lastCombo = 0;

    constructor(private readonly _refs: ModelDebugFlowRefs) {}

    get active(): boolean {
        return this._active;
    }

    enter() {
        this._refs.debug('enterModelDebug');
        this._active = true;
        this._cameraYaw = Math.PI / 2;
        this._cameraPitch = 0.04;
        this._cameraDistance = 3.2;
        this._cameraDragging = false;
        this._speedScale = MOTION_TUNING.animationSpeedScale;
        this._debugRhythmBonus = 0;
        this._lastRating = null;
        this._lastCombo = 0;
        this._debugMotor.startRace(0, SWIMMER_BALANCE.baseSpeed);

        if (this._refs.cameraNode) {
            this._refs.cameraPos.set(this._refs.cameraNode.position);
        }
        this.applySpeed();
        this.updateDebugHud();

        if (this._refs.inputManager) {
            this._refs.inputManager.modelDebugMode = true;
        }
        this.stopAllAi();
        this._refs.raceManager?.resetRace();
        this._refs.setState(GameState.READY);
        this._refs.uiFlow.showModelDebugHud();
        for (const swimmer of this._refs.aiSwimmers) {
            swimmer.node.active = false;
        }
        if (this._refs.playerSwimmer) {
            this._refs.playerSwimmer.node.active = true;
            this._refs.playerSwimmer.reset();
            this._refs.playerSwimmer.node.setPosition(12, 0.24, this._refs.playerLaneZ);
            this._refs.playerSwimmer.cartoonRig?.setModelDebugMode(true);
            this._refs.playerSwimmer.cartoonRig?.setModelDebugSpeedScale(this._speedScale);
        }
        this.updateCamera(1);
        const camera = this._refs.cameraNode?.getComponent(Camera);
        if (camera) {
            camera.fov = 28;
        }
    }

    exit(showStart: boolean) {
        if (!this._active) {
            return;
        }
        this._refs.debug('exitModelDebug');
        this._active = false;
        this._cameraDragging = false;
        if (this._refs.inputManager) {
            this._refs.inputManager.modelDebugMode = false;
        }
        this._refs.uiFlow.hideModelDebugHud();
        for (const swimmer of this._refs.aiSwimmers) {
            swimmer.node.active = true;
        }
        this._refs.playerSwimmer?.cartoonRig?.setModelDebugMode(false);
        this._debugMotor.stopRace();
        this._refs.playerSwimmer?.reset();
        this._refs.resetExtraAiSwimmers();
        this._refs.raceCameraDirector.resetBroadcastCamera();
        const camera = this._refs.cameraNode?.getComponent(Camera);
        if (camera) {
            camera.fov = 36;
        }
        if (showStart) {
            this._refs.showStartScreen();
        }
    }

    handleStroke(type: StrokeType): boolean {
        if (!this._active) {
            return false;
        }
        const result = this.evaluateDebugStroke(type);
        this._refs.playerSwimmer?.cartoonRig?.triggerStroke(type);
        if (!result || type !== StrokeType.BOTH || result.rating !== Rating.MISS) {
            this._debugMotor.recordStroke(type);
        }
        if (type === StrokeType.LEFT) {
            this._refs.debug('model debug: left hand + right foot');
        } else if (type === StrokeType.RIGHT) {
            this._refs.debug('model debug: right hand + left foot');
        } else {
            this._refs.debug('model debug: both hands + both feet');
        }
        this.updateDebugHud();
        return true;
    }

    handleStrokeHeld(type: StrokeType, held: boolean): boolean {
        if (!this._active) {
            return false;
        }
        this._refs.playerSwimmer?.cartoonRig?.setStrokeHeld(type, held);
        this._debugMotor.setStrokeHeld(type, held);
        const evaluator = this._refs.playerSwimmer?.rhythmEvaluator;
        if (evaluator) {
            if (held) {
                evaluator.beginHold(type);
            } else {
                this.applyDebugRhythmResult(evaluator.endHold(type));
            }
        }
        this.updateDebugHud();
        return true;
    }

    update(dt: number) {
        if (!this._active) {
            return;
        }
        this.syncSpeedFromTuning();
        const finished = this._debugMotor.update(dt, {
            isAI: false,
            aiPower: 1,
            aiMaxSpeedScale: 1,
            rhythmBonus: this._debugRhythmBonus,
        });
        if (finished) {
            this._debugMotor.startRace(0, Math.max(SWIMMER_BALANCE.baseSpeed, this._debugMotor.currentSpeed));
        }
        this.updateDebugHud();
    }

    updateCamera(smooth = 0.18) {
        if (!this._refs.cameraNode) {
            return;
        }
        const target = new Vec3(12, 0.54, this._refs.playerLaneZ);
        const cosPitch = Math.cos(this._cameraPitch);
        const desiredPos = new Vec3(
            target.x + Math.cos(this._cameraYaw) * cosPitch * this._cameraDistance,
            target.y + Math.sin(this._cameraPitch) * this._cameraDistance,
            target.z + Math.sin(this._cameraYaw) * cosPitch * this._cameraDistance,
        );
        Vec3.lerp(this._refs.cameraPos, this._refs.cameraPos, desiredPos, smooth);
        Vec3.lerp(this._refs.cameraTarget, this._refs.cameraTarget, target, smooth);
        this._refs.cameraNode.setPosition(this._refs.cameraPos);
        this._refs.cameraNode.lookAt(this._refs.cameraTarget);
    }

    onMouseDown(event: EventMouse): boolean {
        if (!this._active) {
            return false;
        }
        const button = event.getButton();
        this._cameraDragging = button === EventMouse.BUTTON_LEFT || button === EventMouse.BUTTON_RIGHT || button === EventMouse.BUTTON_MIDDLE;
        return true;
    }

    onMouseMove(event: EventMouse): boolean {
        if (!this._active) {
            return false;
        }
        if (!this._cameraDragging) {
            return true;
        }
        this._cameraYaw -= event.getDeltaX() * 0.008;
        this._cameraPitch += event.getDeltaY() * 0.006;
        this._cameraPitch = clamp(this._cameraPitch, -0.85, 0.85);
        return true;
    }

    onMouseUp(): boolean {
        if (!this._active) {
            return false;
        }
        this._cameraDragging = false;
        return true;
    }

    onMouseWheel(event: EventMouse): boolean {
        if (!this._active) {
            return false;
        }
        this._cameraDistance = clamp(this._cameraDistance - event.getScrollY() * 0.004, 1.45, 7.5);
        return true;
    }

    slowMotion() {
        if (!this._active) {
            return;
        }
        this._speedScale = clamp(this._speedScale - 0.1, 0.1, 1.5);
        MOTION_TUNING.animationSpeedScale = this._speedScale;
        this.applySpeed();
    }

    speedUpMotion() {
        if (!this._active) {
            return;
        }
        this._speedScale = clamp(this._speedScale + 0.1, 0.1, 1.5);
        MOTION_TUNING.animationSpeedScale = this._speedScale;
        this.applySpeed();
    }

    private applySpeed() {
        this._refs.playerSwimmer?.cartoonRig?.setModelDebugSpeedScale(this._speedScale);
        if (this._refs.speedLabel) {
            this._refs.speedLabel.string = `Speed ${this._speedScale.toFixed(2)}x`;
        }
        this._refs.debug(`model debug speed=${this._speedScale.toFixed(2)}x`);
    }

    private syncSpeedFromTuning() {
        const next = clamp(MOTION_TUNING.animationSpeedScale, 0.1, 1.5);
        if (Math.abs(next - this._speedScale) < 0.001) {
            return;
        }
        this._speedScale = next;
        MOTION_TUNING.animationSpeedScale = next;
        this.applySpeed();
    }

    private evaluateDebugStroke(type: StrokeType): RhythmResult | null {
        const evaluator = this._refs.playerSwimmer?.rhythmEvaluator;
        if (!evaluator) {
            return null;
        }
        return this.applyDebugRhythmResult(evaluator.evaluate(type));
    }

    private applyDebugRhythmResult(result: RhythmResult | null): RhythmResult | null {
        if (!result) {
            return null;
        }
        this._debugRhythmBonus = Math.max(0, result.speedMultiplier - 1);
        this._lastRating = result.rating;
        this._lastCombo = result.combo;
        return result;
    }

    private updateDebugHud() {
        if (this._refs.ratingLabel) {
            this._refs.ratingLabel.string = this._lastRating
                ? `${this._lastRating.toUpperCase()}  ${this._lastCombo} COMBO`
                : 'READY';
            this._refs.ratingLabel.color = this.ratingColor(this._lastRating);
        }
        if (this._refs.swimSpeedLabel) {
            const speed = this._debugMotor.currentSpeed;
            const ratio = SWIMMER_BALANCE.maxSpeed > 0 ? Math.round((speed / SWIMMER_BALANCE.maxSpeed) * 100) : 0;
            this._refs.swimSpeedLabel.string = `${speed.toFixed(2)} m/s  ${ratio}%`;
        }
    }

    private ratingColor(rating: Rating | null): Color {
        if (rating === Rating.PERFECT) {
            return new Color(255, 224, 89, 255);
        }
        if (rating === Rating.GOOD) {
            return new Color(80, 242, 161, 255);
        }
        if (rating === Rating.MISS) {
            return new Color(255, 92, 92, 255);
        }
        return new Color(230, 244, 250, 255);
    }

    private stopAllAi() {
        for (const controller of this._refs.aiControllers) {
            controller.stopSwimming();
        }
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
