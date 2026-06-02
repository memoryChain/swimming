import { Camera, EventMouse, Label, Node, Vec3 } from 'cc';
import { RaceCameraDirector } from '../camera/RaceCameraDirector';
import { AISwimmerController } from '../entity/AISwimmerController';
import { Swimmer } from '../entity/Swimmer';
import { GameState, StrokeType } from '../core/GameConstants';
import { InputManager } from '../core/InputManager';
import { RaceManager } from '../core/RaceManager';

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
    startScreen: Node | null;
    raceHud: Node | null;
    modelDebugHud: Node | null;
    speedLabel: Label | null;
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
    private _speedScale = 0.35;

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
        this._speedScale = 0.35;

        if (this._refs.cameraNode) {
            this._refs.cameraPos.set(this._refs.cameraNode.position);
        }
        this.applySpeed();

        if (this._refs.inputManager) {
            this._refs.inputManager.modelDebugMode = true;
        }
        this.stopAllAi();
        this._refs.raceManager?.resetRace();
        this._refs.setState(GameState.READY);
        if (this._refs.startScreen) {
            this._refs.startScreen.active = false;
        }
        if (this._refs.raceHud) {
            this._refs.raceHud.active = false;
        }
        if (this._refs.modelDebugHud) {
            this._refs.modelDebugHud.active = true;
        }
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
        if (this._refs.modelDebugHud) {
            this._refs.modelDebugHud.active = false;
        }
        for (const swimmer of this._refs.aiSwimmers) {
            swimmer.node.active = true;
        }
        this._refs.playerSwimmer?.cartoonRig?.setModelDebugMode(false);
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
        if (type === StrokeType.ARM) {
            this._refs.playerSwimmer?.cartoonRig?.triggerArmStroke();
            this._refs.debug('model debug: arms');
        } else {
            this._refs.playerSwimmer?.cartoonRig?.triggerKick();
            this._refs.debug('model debug: legs');
        }
        return true;
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
        this.applySpeed();
    }

    speedUpMotion() {
        if (!this._active) {
            return;
        }
        this._speedScale = clamp(this._speedScale + 0.1, 0.1, 1.5);
        this.applySpeed();
    }

    private applySpeed() {
        this._refs.playerSwimmer?.cartoonRig?.setModelDebugSpeedScale(this._speedScale);
        if (this._refs.speedLabel) {
            this._refs.speedLabel.string = `Speed ${this._speedScale.toFixed(2)}x`;
        }
        this._refs.debug(`model debug speed=${this._speedScale.toFixed(2)}x`);
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
