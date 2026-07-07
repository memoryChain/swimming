import { EventMouse, input, Input, Node } from 'cc';
import { StrokeType } from './GameConstants';
import { INPUT_TUNING, STABILITY_TUNING } from './InputTuning';

export type InputRouterCallbacks = {
    onStroke: (type: StrokeType) => void;
    onStrokeHeld: (type: StrokeType, held: boolean) => void;
    onKickStroke: (type: StrokeType) => void;
    onDiveChargeStart: () => void;
    onDiveRelease: (holdSeconds: number) => void;
    onPrimaryAction: () => void;
    onToggleDebug: () => void;
    onCycleRaceCamera: () => void;
    onToggleFreeRaceCamera: () => void;
    onToggleCameraFollowAi: () => void;
    onToggleSplashCulling: () => void;
    onToggleSplashParticles: () => void;
    onCycleBulletTime: () => void;
    onModelDebugSpeedDown: () => void;
    onModelDebugSpeedUp: () => void;
    onDebugCameraMouseDown: (event: EventMouse) => void;
    onDebugCameraMouseMove: (event: EventMouse) => void;
    onDebugCameraMouseUp: () => void;
    onDebugCameraWheel: (event: EventMouse) => void;
};

export class InputRouter {
    private _lastPadStrokeMs = 0;
    private _lastPadStrokeType: StrokeType | null = null;
    private _nextAutoPadStrokeType = StrokeType.LEFT;
    private _activeAutoPadStrokeType: StrokeType | null = null;

    // Press classification (shared by touch pad, single-tap S key and keyboard
    // A/D): the contralateral leg kick fires immediately on press. If the press is
    // then held longer than the minimum hold threshold it is promoted to an arm
    // stroke (which the leg then follows). Tracked per side so A and D can be held
    // independently in the editor.
    private readonly _leftPress = { active: false, startedMs: 0, promoted: false };
    private readonly _rightPress = { active: false, startedMs: 0, promoted: false };

    constructor(
        private readonly _target: Node,
        private readonly _callbacks: InputRouterCallbacks,
    ) {}

    bind() {
        this.unbind();
        this._target.on('left-stroke', this.onLeftStroke, this);
        this._target.on('right-stroke', this.onRightStroke, this);
        this._target.on('left-stroke-held', this.onLeftStrokeHeld, this);
        this._target.on('right-stroke-held', this.onRightStrokeHeld, this);
        this._target.on('pad-stroke', this.onPadStroke, this);
        this._target.on('pad-stroke-end', this.onPadStrokeEnd, this);
        this._target.on('dive-charge-start', this.onDiveChargeStart, this);
        this._target.on('dive-release', this.onDiveRelease, this);
        this._target.on('primary-action', this.onPrimaryAction, this);
        this._target.on('toggle-debug', this.onToggleDebug, this);
        this._target.on('cycle-race-camera', this.onCycleRaceCamera, this);
        this._target.on('toggle-free-race-camera', this.onToggleFreeRaceCamera, this);
        this._target.on('toggle-camera-follow-ai', this.onToggleCameraFollowAi, this);
        this._target.on('toggle-splash-culling', this.onToggleSplashCulling, this);
        this._target.on('toggle-splash-particles', this.onToggleSplashParticles, this);
        this._target.on('cycle-bullet-time', this.onCycleBulletTime, this);
        this._target.on('model-debug-speed-down', this.onModelDebugSpeedDown, this);
        this._target.on('model-debug-speed-up', this.onModelDebugSpeedUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onDebugCameraMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onDebugCameraMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onDebugCameraMouseUp, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onDebugCameraWheel, this);
    }

    unbind() {
        this._target.off('left-stroke', this.onLeftStroke, this);
        this._target.off('right-stroke', this.onRightStroke, this);
        this._target.off('left-stroke-held', this.onLeftStrokeHeld, this);
        this._target.off('right-stroke-held', this.onRightStrokeHeld, this);
        this._target.off('pad-stroke', this.onPadStroke, this);
        this._target.off('pad-stroke-end', this.onPadStrokeEnd, this);
        this._target.off('dive-charge-start', this.onDiveChargeStart, this);
        this._target.off('dive-release', this.onDiveRelease, this);
        this._target.off('primary-action', this.onPrimaryAction, this);
        this._target.off('toggle-debug', this.onToggleDebug, this);
        this._target.off('cycle-race-camera', this.onCycleRaceCamera, this);
        this._target.off('toggle-free-race-camera', this.onToggleFreeRaceCamera, this);
        this._target.off('toggle-camera-follow-ai', this.onToggleCameraFollowAi, this);
        this._target.off('toggle-splash-culling', this.onToggleSplashCulling, this);
        this._target.off('toggle-splash-particles', this.onToggleSplashParticles, this);
        this._target.off('cycle-bullet-time', this.onCycleBulletTime, this);
        this._target.off('model-debug-speed-down', this.onModelDebugSpeedDown, this);
        this._target.off('model-debug-speed-up', this.onModelDebugSpeedUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onDebugCameraMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onDebugCameraMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onDebugCameraMouseUp, this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onDebugCameraWheel, this);
    }

    handlePadStroke(type: StrokeType) {
        const now = Date.now();
        if (this._lastPadStrokeType === type && now - this._lastPadStrokeMs < INPUT_TUNING.padStrokeDedupeMs) {
            return;
        }
        this._lastPadStrokeType = type;
        this._lastPadStrokeMs = now;
        this.beginPress(type);
    }

    handlePadStrokeEnd(type: StrokeType) {
        this.endPress(type);
    }

    // Begin classifying a press. The leg kick fires right away so the legs react
    // to the player's tap rhythm instantly. If the press is held past
    // STABILITY_TUNING.minHoldSeconds, tick() promotes it to an arm stroke.
    private beginPress(type: StrokeType) {
        const press = this.pressState(type);
        press.active = true;
        press.startedMs = Date.now();
        press.promoted = false;
        this._callbacks.onKickStroke(type);
    }

    private endPress(type: StrokeType) {
        const press = this.pressState(type);
        if (!press.active) {
            return;
        }
        // The kick already fired on press. Only a promoted (long) press needs to
        // close out its arm stroke on release; a short press is already done.
        if (press.promoted) {
            this._callbacks.onStrokeHeld(type, false);
        }
        press.active = false;
        press.promoted = false;
    }

    private pressState(type: StrokeType) {
        return type === StrokeType.LEFT ? this._leftPress : this._rightPress;
    }

    // Per-frame: promote a still-held press to an arm stroke once it has been
    // held long enough. Called from the game update loop.
    tick() {
        const thresholdMs = Math.max(0, STABILITY_TUNING.minHoldSeconds) * 1000;
        const now = Date.now();
        this.promoteIfDue(StrokeType.LEFT, now, thresholdMs);
        this.promoteIfDue(StrokeType.RIGHT, now, thresholdMs);
    }

    private promoteIfDue(type: StrokeType, now: number, thresholdMs: number) {
        const press = this.pressState(type);
        if (!press.active || press.promoted) {
            return;
        }
        if (now - press.startedMs >= thresholdMs) {
            press.promoted = true;
            this._callbacks.onStrokeHeld(type, true);
            this._callbacks.onStroke(type);
        }
    }

    handleAutoPadStroke() {
        if (this._activeAutoPadStrokeType !== null) {
            return;
        }
        const type = this._nextAutoPadStrokeType;
        this._nextAutoPadStrokeType = type === StrokeType.LEFT ? StrokeType.RIGHT : StrokeType.LEFT;
        this._activeAutoPadStrokeType = type;
        this.handlePadStroke(type);
    }

    handleAutoPadStrokeEnd() {
        if (this._activeAutoPadStrokeType === null) {
            return;
        }
        this.handlePadStrokeEnd(this._activeAutoPadStrokeType);
        this._activeAutoPadStrokeType = null;
    }

    resetAutoPadSequence() {
        if (this._activeAutoPadStrokeType !== null) {
            this.handlePadStrokeEnd(this._activeAutoPadStrokeType);
        }
        this._activeAutoPadStrokeType = null;
        this._nextAutoPadStrokeType = StrokeType.LEFT;
        this._lastPadStrokeType = null;
        this._lastPadStrokeMs = 0;
        this._leftPress.active = false;
        this._leftPress.promoted = false;
        this._rightPress.active = false;
        this._rightPress.promoted = false;
    }

    // Keyboard A/D go through the same press classifier as touch, driven by the
    // held events emitted from InputManager. The plain stroke events are no-ops
    // now that classification owns stroke promotion.
    private onLeftStroke() {}

    private onRightStroke() {}

    private onLeftStrokeHeld(held: boolean) {
        if (held) {
            this.beginPress(StrokeType.LEFT);
        } else {
            this.endPress(StrokeType.LEFT);
        }
    }

    private onRightStrokeHeld(held: boolean) {
        if (held) {
            this.beginPress(StrokeType.RIGHT);
        } else {
            this.endPress(StrokeType.RIGHT);
        }
    }

    // S key: single-tap that simulates a mobile single touch (auto-alternating side).
    private onPadStroke() {
        this.handleAutoPadStroke();
    }

    private onPadStrokeEnd() {
        this.handleAutoPadStrokeEnd();
    }

    private onDiveChargeStart() {
        this._callbacks.onDiveChargeStart();
    }

    private onDiveRelease(holdSeconds: number) {
        this._callbacks.onDiveRelease(holdSeconds);
    }

    private onPrimaryAction() {
        this._callbacks.onPrimaryAction();
    }

    private onToggleDebug() {
        this._callbacks.onToggleDebug();
    }

    private onCycleRaceCamera() {
        this._callbacks.onCycleRaceCamera();
    }

    private onToggleFreeRaceCamera() {
        this._callbacks.onToggleFreeRaceCamera();
    }

    private onToggleCameraFollowAi() {
        this._callbacks.onToggleCameraFollowAi();
    }

    private onToggleSplashCulling() {
        this._callbacks.onToggleSplashCulling();
    }

    private onToggleSplashParticles() {
        this._callbacks.onToggleSplashParticles();
    }

    private onCycleBulletTime() {
        this._callbacks.onCycleBulletTime();
    }

    private onModelDebugSpeedDown() {
        this._callbacks.onModelDebugSpeedDown();
    }

    private onModelDebugSpeedUp() {
        this._callbacks.onModelDebugSpeedUp();
    }

    private onDebugCameraMouseDown(event: EventMouse) {
        this._callbacks.onDebugCameraMouseDown(event);
    }

    private onDebugCameraMouseMove(event: EventMouse) {
        this._callbacks.onDebugCameraMouseMove(event);
    }

    private onDebugCameraMouseUp() {
        this._callbacks.onDebugCameraMouseUp();
    }

    private onDebugCameraWheel(event: EventMouse) {
        this._callbacks.onDebugCameraWheel(event);
    }
}
