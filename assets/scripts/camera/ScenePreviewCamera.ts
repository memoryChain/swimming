import { EventKeyboard, game, Game, input, Input, KeyCode, Node, Vec3 } from 'cc';
import { clampCameraHeightToWaterSide } from './RaceCameraDirector';

const LOOK_SENSITIVITY_SCALE = 1 / 3;

/** 场景预览专用自由相机，位置仅由输入改变，不读取人物状态。 */
export class ScenePreviewCamera {
    private readonly _position = new Vec3();
    private readonly _eye = new Vec3();
    private readonly _target = new Vec3();
    private readonly _keys = new Set<KeyCode>();
    private _yaw = 0;
    private _pitch = 0;
    private _dirty = true;

    constructor(private readonly _camera: Node, private readonly _waterY: number, x: number, y: number, z: number) {
        // 仅在进入预览时确定初始视角，之后保持独立。
        const yaw = Math.PI * 0.82;
        this._position.set(x + Math.cos(yaw) * 5.5, y - 0.44, z + Math.sin(yaw) * 5.5);
        this._yaw = yaw + Math.PI;
        this._pitch = 0.08;
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.on(Game.EVENT_HIDE, this.clearKeys, this);
    }

    dispose() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.off(Game.EVENT_HIDE, this.clearKeys, this);
        this.clearKeys();
    }

    look(deltaX: number, deltaY: number) {
        this._yaw += deltaX * 0.008 * LOOK_SENSITIVITY_SCALE;
        this._pitch = Math.max(-1.5, Math.min(1.5, this._pitch + deltaY * 0.006 * LOOK_SENSITIVITY_SCALE));
        this._dirty = true;
    }

    dolly(scroll: number) {
        this.move(scroll * 0.02, 0, 0);
    }

    update(dt: number): boolean {
        const forward = Number(this._keys.has(KeyCode.KEY_W)) - Number(this._keys.has(KeyCode.KEY_S));
        const right = Number(this._keys.has(KeyCode.KEY_D)) - Number(this._keys.has(KeyCode.KEY_A));
        const up = Number(this._keys.has(KeyCode.KEY_E)) - Number(this._keys.has(KeyCode.KEY_Q));
        const length = Math.hypot(forward, right, up);
        if (length > 0) {
            const fast = this._keys.has(KeyCode.SHIFT_LEFT) || this._keys.has(KeyCode.SHIFT_RIGHT);
            const step = Math.min(dt, 0.05) * (fast ? 18 : 6) / length;
            this.move(forward * step, right * step, up * step);
        }
        const underwater = this._position.y < this._waterY;
        if (this._dirty && this._camera.isValid) {
            this._eye.set(this._position);
            // 只修正渲染位置，保留连续移动坐标，避免卡在水面排除带。
            this._eye.y = clampCameraHeightToWaterSide(this._eye.y, this._waterY, underwater);
            const cosPitch = Math.cos(this._pitch);
            this._target.set(
                this._eye.x + Math.cos(this._yaw) * cosPitch,
                this._eye.y + Math.sin(this._pitch),
                this._eye.z + Math.sin(this._yaw) * cosPitch,
            );
            this._camera.setWorldPosition(this._eye);
            this._camera.lookAt(this._target);
            this._dirty = false;
        }
        return underwater;
    }

    private move(forward: number, right: number, up: number) {
        const cosYaw = Math.cos(this._yaw);
        const sinYaw = Math.sin(this._yaw);
        const cosPitch = Math.cos(this._pitch);
        this._position.x += cosYaw * cosPitch * forward - sinYaw * right;
        this._position.y += Math.sin(this._pitch) * forward + up;
        this._position.z += sinYaw * cosPitch * forward + cosYaw * right;
        this._dirty = true;
    }

    private onKeyDown(event: EventKeyboard) { this._keys.add(event.keyCode); }
    private onKeyUp(event: EventKeyboard) { this._keys.delete(event.keyCode); }
    private clearKeys() { this._keys.clear(); }
}
