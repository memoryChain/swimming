import { _decorator, Component, EventKeyboard, EventMouse, EventTouch, input, Input, KeyCode, Node, view } from 'cc';
import { StrokeType } from './GameConstants';

const { ccclass, property } = _decorator;

@ccclass('InputManager')
export class InputManager extends Component {
    @property(Node) public strokeTarget: Node = null;
    public modelDebugMode = false;
    public pointerInputEnabled = true;
    public diveInputEnabled = true;

    private _leftHeld = false;
    private _rightHeld = false;
    private _diveCharging = false;
    private _diveChargeStartedAt = 0;
    private _leftMouseStrokeType: StrokeType | null = null;
    private _touchStrokeType: StrokeType | null = null;

    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private onKeyDown(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_A || event.keyCode === KeyCode.ARROW_LEFT) {
            const wasHeld = this._leftHeld;
            this.setInputHeld(StrokeType.LEFT, true);
            if (!wasHeld) {
                this.emitStroke(StrokeType.LEFT);
            }
        } else if (event.keyCode === KeyCode.KEY_D || event.keyCode === KeyCode.ARROW_RIGHT) {
            const wasHeld = this._rightHeld;
            this.setInputHeld(StrokeType.RIGHT, true);
            if (!wasHeld) {
                this.emitStroke(StrokeType.RIGHT);
            }
        } else if (this.modelDebugMode && event.keyCode === KeyCode.KEY_Q) {
            this.strokeTarget?.emit('model-debug-speed-down');
        } else if (this.modelDebugMode && event.keyCode === KeyCode.KEY_E) {
            this.strokeTarget?.emit('model-debug-speed-up');
        } else if (event.keyCode === KeyCode.SPACE || event.keyCode === KeyCode.ENTER) {
            this.strokeTarget?.emit('primary-action');
        } else if (event.keyCode === KeyCode.F3 || event.keyCode === KeyCode.BACK_QUOTE) {
            this.strokeTarget?.emit('toggle-debug');
        } else if (event.keyCode === KeyCode.KEY_C) {
            this.strokeTarget?.emit('cycle-race-camera');
        } else if (event.keyCode === KeyCode.KEY_V) {
            this.strokeTarget?.emit('toggle-free-race-camera');
        } else if (event.keyCode === KeyCode.KEY_K) {
            this.strokeTarget?.emit('toggle-splash-culling');
        } else if (event.keyCode === KeyCode.KEY_L) {
            this.strokeTarget?.emit('toggle-splash-particles');
        }
    }

    private onKeyUp(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_A || event.keyCode === KeyCode.ARROW_LEFT) {
            this.setInputHeld(StrokeType.LEFT, false);
        } else if (event.keyCode === KeyCode.KEY_D || event.keyCode === KeyCode.ARROW_RIGHT) {
            this.setInputHeld(StrokeType.RIGHT, false);
        }
    }

    private onMouseDown(event: EventMouse) {
        if (this.modelDebugMode || !this.pointerInputEnabled) {
            return;
        }
        if (event.getButton() === EventMouse.BUTTON_LEFT) {
            const mousePos = event.getUILocation();
            const halfX = view.getVisibleSize().width / 2;
            const type = mousePos.x < halfX ? StrokeType.LEFT : StrokeType.RIGHT;
            this._leftMouseStrokeType = type;
            this.setInputHeld(type, true);
            this.emitStroke(type);
        } else if (event.getButton() === EventMouse.BUTTON_RIGHT) {
            this.setInputHeld(StrokeType.RIGHT, true);
            this.emitStroke(StrokeType.RIGHT);
        }
    }

    private onMouseUp(event: EventMouse) {
        if (event.getButton() === EventMouse.BUTTON_LEFT) {
            if (this._leftMouseStrokeType) {
                this.setInputHeld(this._leftMouseStrokeType, false);
                this._leftMouseStrokeType = null;
            } else {
                this.releaseDiveInput();
            }
        } else if (event.getButton() === EventMouse.BUTTON_RIGHT) {
            this.setInputHeld(StrokeType.RIGHT, false);
        }
    }

    private onTouchStart(event: EventTouch) {
        if (this.modelDebugMode || !this.pointerInputEnabled) {
            return;
        }
        const touchPos = event.getUILocation();
        const halfX = view.getVisibleSize().width / 2;
        const type = touchPos.x < halfX ? StrokeType.LEFT : StrokeType.RIGHT;
        this._touchStrokeType = type;
        this.setInputHeld(type, true);
        this.emitStroke(type);
    }

    private onTouchEnd() {
        if (this._touchStrokeType) {
            this.setInputHeld(this._touchStrokeType, false);
            this._touchStrokeType = null;
            return;
        }
        this.releaseDiveInput();
    }

    private emitStroke(type: StrokeType) {
        const target = this.strokeTarget || this.node;
        target.emit(type === StrokeType.LEFT ? 'left-stroke' : 'right-stroke');
    }

    private setInputHeld(type: StrokeType, held: boolean) {
        if (type === StrokeType.LEFT) {
            if (this._leftHeld === held) {
                return;
            }
            this._leftHeld = held;
        } else {
            if (this._rightHeld === held) {
                return;
            }
            this._rightHeld = held;
        }
        this.emitStrokeHeld(type, held);

        if (!this.diveInputEnabled || this.modelDebugMode) {
            return;
        }
        if (this._leftHeld && this._rightHeld && !this._diveCharging) {
            this._diveCharging = true;
            this._diveChargeStartedAt = Date.now() / 1000;
            this.emitDiveChargeStart();
        } else if (!held && this._diveCharging) {
            this.emitDiveRelease();
        }
    }

    private releaseDiveInput() {
        if (this._diveCharging) {
            this.emitDiveRelease();
        }
        this._leftHeld = false;
        this._rightHeld = false;
        this.emitStrokeHeld(StrokeType.LEFT, false);
        this.emitStrokeHeld(StrokeType.RIGHT, false);
    }

    private emitStrokeHeld(type: StrokeType, held: boolean) {
        const target = this.strokeTarget || this.node;
        target.emit(type === StrokeType.LEFT ? 'left-stroke-held' : 'right-stroke-held', held);
    }

    private emitDiveChargeStart() {
        const target = this.strokeTarget || this.node;
        target.emit('dive-charge-start');
    }

    private emitDiveRelease() {
        const target = this.strokeTarget || this.node;
        const holdSeconds = Math.max(0, Date.now() / 1000 - this._diveChargeStartedAt);
        this._diveCharging = false;
        target.emit('dive-release', holdSeconds);
    }
}
