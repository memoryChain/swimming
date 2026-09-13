import { Node, Sprite, UIOpacity, UITransform, view } from 'cc';
import { makeUiNode } from './RuntimeUiFactory';
import { loadAvatarUiSpriteFrame } from './AvatarUiAssets';
import { RESOURCE_PATHS } from '../core/ResourcePaths';

export const CAMERA_SPEED_LINE_TUNING = { speedLineThreshold: 4.2 };
const INTERVAL = 1 / 30;
// 左右边缘各三条；中央视野保持空白，错开长度、位置及周期。
const LINES = [
    [-1, 0.31, 0.00, 0.88], [1, 0.16, 0.37, 1.10],
    [-1, -0.12, 0.67, 1.04], [1, -0.35, 0.13, 0.82],
    [-1, -0.65, 0.43, 1.15], [1, -0.70, 0.81, 0.94],
] as const;
type Line = { node: Node; opacity: UIOpacity; sprite: Sprite; angle: number };

export class CameraSpeedLineOverlay {
    private _root: Node | null = null;
    private readonly _lines: Line[] = [];
    private _ready = false;
    private _intensity = 0;
    private _phase = 0;
    private _elapsed = INTERVAL;
    private _width = 0;
    private _height = 0;
    private _vanishingX = 0;
    private _vanishingY = 0;
    private _refresh = false;

    bind(hud: Node) {
        if (!hud?.isValid || this._root?.isValid) return;
        this._lines.length = 0;
        this._ready = false;
        this._width = this._height = 0;
        this._intensity = this._phase = 0;
        this._elapsed = INTERVAL;
        this._refresh = false;
        const root = this._root = makeUiNode('CameraSpeedLines', hud);
        root.setSiblingIndex(0);
        for (let i = 0; i < LINES.length; i++) {
            const node = makeUiNode(`SoftAirLine${i}`, root);
            const sprite = node.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 0;
            this._lines.push({ node, sprite, opacity, angle: NaN });
        }
        root.active = false;
        loadAvatarUiSpriteFrame(RESOURCE_PATHS.softSpeedStreak, (frame) => {
            if (!frame || !root.isValid || this._root !== root) return;
            for (const line of this._lines) line.sprite.spriteFrame = frame;
            this._ready = true;
        });
    }

    update(dt: number, speed: number, visible: boolean, sprintBoost = false, jumpActive = false, flightPitch = 0) {
        if (!this._root?.isValid || !this._ready) return;
        // 离水结束、切镜头或父 HUD 隐藏时立即清理，不做投影和变换工作。
        if (!visible || !this._root.parent?.activeInHierarchy) { this.hide(); return; }
        const threshold = CAMERA_SPEED_LINE_TUNING.speedLineThreshold * (sprintBoost ? 0.7 : 1);
        const target = jumpActive
            ? Math.max(0, Math.min(1, flightPitch / 0.20))
            : (speed >= threshold ? (sprintBoost ? 0.85 : 0.55) : 0);
        if (target === 0 && this._intensity < 0.015) { this.hide(); return; }
        this._intensity += (target - this._intensity) * (1 - Math.exp(-Math.max(0, dt) * 14));
        if (!this._root.active) this._root.active = true;
        this._phase = (this._phase + Math.max(0, dt) * (3.2 + this._intensity * 1.5)) % 1;
        this._elapsed += Math.max(0, dt);
        if (this._elapsed < INTERVAL) return;
        this._elapsed %= INTERVAL;
        const size = view.getVisibleSize();
        if (size.width !== this._width || size.height !== this._height) {
            this._width = size.width; this._height = size.height;
            this._root.getComponent(UITransform)!.setContentSize(size.width, size.height);
            for (let i = 0; i < this._lines.length; i++) {
                const length = size.width * 0.18 * LINES[i][3];
                this._lines[i].node.getComponent(UITransform)!.setContentSize(length, length / 8);
            }
        }
        const halfWidth = this._width * 0.5;
        const halfHeight = this._height * 0.5;
        const originX = Math.max(-halfWidth * 0.25, Math.min(halfWidth * 0.25, this._vanishingX));
        const originY = Math.max(-halfHeight * 0.25, Math.min(halfHeight * 0.25, this._vanishingY));
        for (let i = 0; i < this._lines.length; i++) {
            const side = LINES[i][0], height = LINES[i][1], offset = LINES[i][2];
            const t = (this._phase + offset) % 1;
            const line = this._lines[i];
            const alpha = Math.round(Math.min(1, t / 0.10) * Math.max(0, Math.min(1, (0.86 - t) / 0.18)) * this._intensity * 245);
            if (line.opacity.opacity !== alpha) line.opacity.opacity = alpha;
            // 位置与长轴使用同一条从消失点射向屏幕边缘的射线。
            const dx = side * halfWidth - originX;
            const dy = halfHeight * height - originY;
            const travel = 0.64 + Math.pow(t, 1.35) * 0.78;
            const x = Math.round(originX + dx * travel);
            const y = Math.round(originY + dy * travel);
            if (line.node.position.x !== x || line.node.position.y !== y) line.node.setPosition(x, y, 0);
            const angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
            if (line.angle !== angle) { line.node.setRotationFromEuler(0, 0, angle); line.angle = angle; }
        }
        this._refresh = true;
    }

    setVanishingPoint(x: number, y: number) { this._vanishingX = x; this._vanishingY = y; }
    get active(): boolean { return this._root?.isValid === true && this._root.active; }
    consumeVanishingPointRefresh(): boolean {
        const pending = this._refresh && this.active;
        this._refresh = false;
        return pending;
    }
    setEnabled(enabled: boolean) { if (!enabled) this.hide(); }
    private hide() {
        if (this._root?.isValid && this._root.active) this._root.active = false;
        this._intensity = 0; this._phase = 0; this._elapsed = INTERVAL; this._refresh = false;
    }
}
