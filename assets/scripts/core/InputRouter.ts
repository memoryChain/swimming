import { EventMouse, EventTouch, input, Input, Node, Vec2 } from 'cc';
import { StrokeType } from './GameConstants';
import { DOLPHIN_JUMP } from './DolphinJumpConfig';
import { INPUT_TUNING, STROKE_QUALITY_TUNING } from './InputTuning';

export type InputRouterCallbacks = {
    onStroke: (type: StrokeType) => void;
    onStrokeHeld: (type: StrokeType, held: boolean, preHeldSeconds?: number) => boolean;
    onKickStroke: (type: StrokeType) => void;
    onDiveChargeStart: () => void;
    onDiveRelease: (holdSeconds: number) => void;
    // Both invisible screen halves held together past the trigger threshold.
    onDolphinJump: () => void;
    onUltimateActivate: () => void;
    onPrimaryAction: () => void;
    onToggleDebug: () => void;
    onCycleRaceCamera: () => void;
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
    // Touch drag / pinch, used by the awards free-look camera. deltaX/deltaY are raw
    // pointer deltas; scroll is a pinch-distance delta (positive = fingers spreading = zoom in).
    onCameraOrbit: (deltaX: number, deltaY: number) => void;
    onCameraZoom: (scroll: number) => void;
};

export class InputRouter {
    private _lastPadStrokeMs = 0;
    private _lastPadStrokeType: StrokeType | null = null;

    // Press classification (shared by the invisible screen halves and keyboard
    // A/D): the contralateral leg kick fires immediately on press. If the press is
    // then held longer than the minimum hold threshold it is promoted to an arm
    // stroke (which the leg then follows). Tracked per side so A and D can be held
    // independently in the editor.
    private readonly _leftPress = { active: false, startedMs: 0, promoted: false };
    private readonly _rightPress = { active: false, startedMs: 0, promoted: false };
    // Dolphin-jump gesture: when both screen halves are held together, the wall
    // clock at which that started (-1 = not both held) and whether this hold has
    // already fired, so it triggers once per two-hand hold.
    private _bothHeldSinceMs = -1;
    private _dolphinGestureFired = false;
    // Awards free-look touch state: whether a multi-finger pinch is in progress and the
    // last measured distance between the first two touch points.
    private _cameraMultiTouch = false;
    private _cameraPinchDistance = 0;

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
        this._target.on('dive-charge-start', this.onDiveChargeStart, this);
        this._target.on('dive-release', this.onDiveRelease, this);
        this._target.on('ultimate-activate', this.onUltimateActivate, this);
        this._target.on('primary-action', this.onPrimaryAction, this);
        this._target.on('toggle-debug', this.onToggleDebug, this);
        this._target.on('cycle-race-camera', this.onCycleRaceCamera, this);
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
        input.on(Input.EventType.TOUCH_START, this.onCameraTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onCameraTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onCameraTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onCameraTouchEnd, this);
    }

    unbind() {
        this._target.off('left-stroke', this.onLeftStroke, this);
        this._target.off('right-stroke', this.onRightStroke, this);
        this._target.off('left-stroke-held', this.onLeftStrokeHeld, this);
        this._target.off('right-stroke-held', this.onRightStrokeHeld, this);
        this._target.off('dive-charge-start', this.onDiveChargeStart, this);
        this._target.off('dive-release', this.onDiveRelease, this);
        this._target.off('ultimate-activate', this.onUltimateActivate, this);
        this._target.off('primary-action', this.onPrimaryAction, this);
        this._target.off('toggle-debug', this.onToggleDebug, this);
        this._target.off('cycle-race-camera', this.onCycleRaceCamera, this);
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
        input.off(Input.EventType.TOUCH_START, this.onCameraTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onCameraTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onCameraTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onCameraTouchEnd, this);
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
    // STROKE_QUALITY_TUNING.minHoldSeconds, tick() promotes it to an arm stroke.
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
        const thresholdMs = Math.max(0, STROKE_QUALITY_TUNING.minHoldSeconds) * 1000;
        const now = Date.now();
        this.promoteIfDue(StrokeType.LEFT, now, thresholdMs);
        this.promoteIfDue(StrokeType.RIGHT, now, thresholdMs);
        this.updateDolphinGesture(now);
    }

    // Fire the dolphin-jump gesture once both screen halves have been held
    // together past the trigger threshold. Releasing either side re-arms it.
    private updateDolphinGesture(now: number) {
        const bothHeld = this._leftPress.active && this._rightPress.active;
        if (!bothHeld) {
            this._bothHeldSinceMs = -1;
            this._dolphinGestureFired = false;
            return;
        }
        if (this._bothHeldSinceMs < 0) {
            this._bothHeldSinceMs = now;
        }
        if (!this._dolphinGestureFired
            && now - this._bothHeldSinceMs >= DOLPHIN_JUMP.triggerHoldSeconds * 1000) {
            this._dolphinGestureFired = true;
            this._callbacks.onDolphinJump();
        }
    }

    private promoteIfDue(type: StrokeType, now: number, thresholdMs: number) {
        const press = this.pressState(type);
        if (!press.active || press.promoted) {
            return;
        }
        if (now - press.startedMs >= thresholdMs) {
            // A held press may still be in the dive-underwater phase, where arm
            // strokes are intentionally unavailable. Keep it promotable so the
            // same press becomes an arm stroke on the first surfaced frame.
            // Cap the carried hold time: underwater waiting must not turn into a
            // pre-held multi-second stroke when it is finally accepted.
            const accepted = this._callbacks.onStrokeHeld(type, true, thresholdMs / 1000);
            if (!accepted) {
                return;
            }
            press.promoted = true;
            this._callbacks.onStroke(type);
        }
    }

    handleScreenStroke(type: StrokeType) {
        this.handlePadStroke(type);
    }

    handleScreenStrokeEnd(type: StrokeType) {
        this.handlePadStrokeEnd(type);
    }

    resetStrokeInput() {
        this._lastPadStrokeType = null;
        this._lastPadStrokeMs = 0;
        this._leftPress.active = false;
        this._leftPress.promoted = false;
        this._rightPress.active = false;
        this._rightPress.promoted = false;
        this._bothHeldSinceMs = -1;
        this._dolphinGestureFired = false;
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

    private onDiveChargeStart() {
        this._callbacks.onDiveChargeStart();
    }

    private onDiveRelease(holdSeconds: number) {
        this._callbacks.onDiveRelease(holdSeconds);
    }

    private onUltimateActivate() {
        this._callbacks.onUltimateActivate();
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

    // Awards free-look touch control: one finger orbits, two fingers pinch-zoom. Gating on the
    // actual awards state happens in the GameManager callback, so this stays a no-op otherwise.
    private onCameraTouchStart(event: EventTouch) {
        const touches = event.getAllTouches();
        this._cameraMultiTouch = touches.length >= 2;
        this._cameraPinchDistance = this._cameraMultiTouch ? touchPairDistance(touches) : 0;
    }

    private onCameraTouchMove(event: EventTouch) {
        const touches = event.getAllTouches();
        if (touches.length >= 2) {
            const distance = touchPairDistance(touches);
            if (this._cameraMultiTouch && this._cameraPinchDistance > 0) {
                this._callbacks.onCameraZoom(distance - this._cameraPinchDistance);
            }
            this._cameraPinchDistance = distance;
            this._cameraMultiTouch = true;
            return;
        }
        this._cameraMultiTouch = false;
        const delta = event.getDelta();
        this._callbacks.onCameraOrbit(delta.x, delta.y);
    }

    private onCameraTouchEnd(event: EventTouch) {
        const touches = event.getAllTouches();
        this._cameraMultiTouch = touches.length >= 2;
        this._cameraPinchDistance = 0;
    }
}

function touchPairDistance(touches: ReadonlyArray<{ getLocation(): Vec2 }>): number {
    const a = touches[0].getLocation();
    const b = touches[1].getLocation();
    return Vec2.distance(a, b);
}
