import { _decorator, Component, EventKeyboard, EventMouse, EventTouch, input, Input, KeyCode, Node, view } from 'cc';
import { StrokeType } from './GameConstants';

const { ccclass, property } = _decorator;

@ccclass('InputManager')
export class InputManager extends Component {
    @property(Node) public strokeTarget: Node = null;
    public modelDebugMode = false;

    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    private onKeyDown(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_A || event.keyCode === KeyCode.ARROW_LEFT) {
            this.emitStroke(StrokeType.LEG);
        } else if (event.keyCode === KeyCode.KEY_D || event.keyCode === KeyCode.ARROW_RIGHT) {
            this.emitStroke(StrokeType.ARM);
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
        }
    }

    private onMouseDown(event: EventMouse) {
        if (this.modelDebugMode) {
            return;
        }
        if (event.getButton() === EventMouse.BUTTON_LEFT) {
            this.emitStroke(StrokeType.LEG);
        } else if (event.getButton() === EventMouse.BUTTON_RIGHT) {
            this.emitStroke(StrokeType.ARM);
        }
    }

    private onTouchStart(event: EventTouch) {
        if (this.modelDebugMode) {
            return;
        }
        const touchPos = event.getUILocation();
        const halfX = view.getVisibleSize().width / 2;
        this.emitStroke(touchPos.x < halfX ? StrokeType.LEG : StrokeType.ARM);
    }

    private emitStroke(type: StrokeType) {
        const target = this.strokeTarget || this.node;
        target.emit(type === StrokeType.ARM ? 'arm-stroke' : 'leg-kick');
    }
}
