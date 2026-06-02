import { EventMouse, input, Input, Node } from 'cc';
import { StrokeType } from './GameConstants';
import { INPUT_TUNING } from './InputTuning';

export type InputRouterCallbacks = {
    onStroke: (type: StrokeType) => void;
    onStrokeHeld: (type: StrokeType, held: boolean) => void;
    onDiveChargeStart: () => void;
    onDiveRelease: (holdSeconds: number) => void;
    onPrimaryAction: () => void;
    onToggleDebug: () => void;
    onCycleRaceCamera: () => void;
    onToggleFreeRaceCamera: () => void;
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
    private _pendingStrokeType: StrokeType | null = null;
    private _pendingStrokeMs = 0;
    private _pendingStrokeTimer: ReturnType<typeof setTimeout> | null = null;

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
        this._target.on('primary-action', this.onPrimaryAction, this);
        this._target.on('toggle-debug', this.onToggleDebug, this);
        this._target.on('cycle-race-camera', this.onCycleRaceCamera, this);
        this._target.on('toggle-free-race-camera', this.onToggleFreeRaceCamera, this);
        this._target.on('model-debug-speed-down', this.onModelDebugSpeedDown, this);
        this._target.on('model-debug-speed-up', this.onModelDebugSpeedUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onDebugCameraMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onDebugCameraMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onDebugCameraMouseUp, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onDebugCameraWheel, this);
    }

    unbind() {
        this.clearPendingStroke();
        this._target.off('left-stroke', this.onLeftStroke, this);
        this._target.off('right-stroke', this.onRightStroke, this);
        this._target.off('left-stroke-held', this.onLeftStrokeHeld, this);
        this._target.off('right-stroke-held', this.onRightStrokeHeld, this);
        this._target.off('dive-charge-start', this.onDiveChargeStart, this);
        this._target.off('dive-release', this.onDiveRelease, this);
        this._target.off('primary-action', this.onPrimaryAction, this);
        this._target.off('toggle-debug', this.onToggleDebug, this);
        this._target.off('cycle-race-camera', this.onCycleRaceCamera, this);
        this._target.off('toggle-free-race-camera', this.onToggleFreeRaceCamera, this);
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
        this._callbacks.onStrokeHeld(type, true);
        this.queueStroke(type);
    }

    handlePadStrokeEnd(type: StrokeType) {
        this._callbacks.onStrokeHeld(type, false);
    }

    private onLeftStroke() {
        this.queueStroke(StrokeType.LEFT);
    }

    private onRightStroke() {
        this.queueStroke(StrokeType.RIGHT);
    }

    private queueStroke(type: StrokeType) {
        if (type === StrokeType.BOTH) {
            this.clearPendingStroke();
            this._callbacks.onStroke(StrokeType.BOTH);
            return;
        }

        const now = Date.now();
        if (this._pendingStrokeType) {
            const pending = this._pendingStrokeType;
            const withinChordWindow = now - this._pendingStrokeMs <= INPUT_TUNING.chordMergeWindowMs;
            if (pending !== type && withinChordWindow) {
                this.clearPendingStroke();
                this._callbacks.onStroke(StrokeType.BOTH);
                return;
            }
            if (pending === type && withinChordWindow) {
                return;
            }
            this.flushPendingStroke();
        }

        this._pendingStrokeType = type;
        this._pendingStrokeMs = now;
        this._pendingStrokeTimer = setTimeout(() => this.flushPendingStroke(), INPUT_TUNING.chordMergeWindowMs);
    }

    private flushPendingStroke() {
        if (!this._pendingStrokeType) {
            return;
        }
        const type = this._pendingStrokeType;
        this.clearPendingStroke();
        this._callbacks.onStroke(type);
    }

    private clearPendingStroke() {
        if (this._pendingStrokeTimer) {
            clearTimeout(this._pendingStrokeTimer);
            this._pendingStrokeTimer = null;
        }
        this._pendingStrokeType = null;
        this._pendingStrokeMs = 0;
    }

    private onLeftStrokeHeld(held: boolean) {
        this._callbacks.onStrokeHeld(StrokeType.LEFT, held);
    }

    private onRightStrokeHeld(held: boolean) {
        this._callbacks.onStrokeHeld(StrokeType.RIGHT, held);
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
