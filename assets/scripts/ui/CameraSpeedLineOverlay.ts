import { Color, Graphics, Node, UITransform, view } from 'cc';
import { makeUiNode } from './RuntimeUiFactory';

export const CAMERA_SPEED_LINE_TUNING = {
    speedLineThreshold: 4.2,
};

const LINE_COLOR = new Color(224, 250, 255, 255);
const LINE_ANCHORS: ReadonlyArray<readonly [number, number, number]> = [
    [-0.92, -0.72, 0.02], [-0.8, -0.94, 0.46], [-0.54, -0.98, 0.79],
    [-0.28, -0.91, 0.61], [0.04, -0.97, 0.2], [0.32, -0.94, 0.14],
    [0.58, -0.92, 0.66], [0.76, -0.72, 0.48], [0.95, -0.58, 0.88],
    [0.95, -0.34, 0.76], [0.98, -0.04, 0.34], [0.88, 0.32, 0.21],
    [0.82, 0.56, 0.63], [0.66, 0.78, 0.55], [0.38, 0.94, 0.11],
    [0.19, 0.93, 0.09], [-0.12, 0.97, 0.51], [-0.38, 0.86, 0.42],
    [-0.66, 0.78, 0.83], [-0.79, 0.56, 0.7], [-0.95, 0.3, 0.27],
    [-0.96, 0.08, 0.36], [-0.98, -0.26, 0.92], [-0.82, -0.48, 0.58],
];

// Screen-space manga streaks that sit behind the race HUD. Each streak is a
// filled perspective trapezoid: narrow toward the screen centre and broad at
// the edge, so it reads as movement coming toward the camera.
export class CameraSpeedLineOverlay {
    private _root: Node | null = null;
    private _graphics: Graphics | null = null;
    private _intensity = 0;
    private _phase = 0;
    private _width = 0;
    private _height = 0;
    private _vanishingX = 0;
    private _vanishingY = 0;
    private readonly _strokeColor = new Color();

    bind(hud: Node) {
        if (!hud?.isValid || this._root?.isValid) {
            return;
        }
        this._root = makeUiNode('CameraSpeedLines', hud);
        this._root.setSiblingIndex(0);
        this._graphics = this._root.addComponent(Graphics);
        this.resize();
        this._root.active = false;
    }

    update(dt: number, speed: number, visible: boolean) {
        if (!this._root?.isValid || !this._graphics) {
            return;
        }
        this.resize();
        const target = visible
            && speed >= CAMERA_SPEED_LINE_TUNING.speedLineThreshold
            ? 1
            : 0;
        const blend = 1 - Math.exp(-Math.max(0, dt) * (target > this._intensity ? 9 : 5));
        this._intensity += (target - this._intensity) * blend;
        this._root.active = this._intensity > 0.015;
        if (!this._root.active) {
            return;
        }
        this._phase = (this._phase + dt * (0.75 + this._intensity * 1.8)) % 1;
        this.draw();
    }

    setVanishingPoint(x: number, y: number) {
        this.resize();
        const halfWidth = this._width * 0.5;
        const halfHeight = this._height * 0.5;
        this._vanishingX = clamp(x, -halfWidth * 0.82, halfWidth * 0.82);
        this._vanishingY = clamp(y, -halfHeight * 0.82, halfHeight * 0.82);
        if (this._root?.active) {
            this.draw();
        }
    }

    private resize() {
        const size = view.getVisibleSize();
        if (size.width === this._width && size.height === this._height) {
            return;
        }
        this._width = size.width;
        this._height = size.height;
        this._root?.getComponent(UITransform)?.setContentSize(size.width, size.height);
    }

    private draw() {
        const graphics = this._graphics!;
        const halfWidth = this._width * 0.5;
        const halfHeight = this._height * 0.5;
        graphics.clear();
        for (const [anchorX, anchorY, offset] of LINE_ANCHORS) {
            const travel = (this._phase + offset) % 1;
            const start = 0.24 + travel * 0.58;
            const directionX = anchorX * halfWidth;
            const directionY = anchorY * halfHeight;
            // Ray-scale at which this direction, starting at the projected lane
            // vanishing point, intersects the rectangular screen.
            const edgeScale = rayScreenEdgeScale(
                this._vanishingX,
                this._vanishingY,
                directionX,
                directionY,
                halfWidth,
                halfHeight,
            );
            const end = edgeScale + 0.06;
            const startX = this._vanishingX + directionX * start;
            const startY = this._vanishingY + directionY * start;
            const endX = this._vanishingX + directionX * end;
            const endY = this._vanishingY + directionY * end;
            const length = Math.hypot(endX - startX, endY - startY);
            if (length <= 0.001) {
                continue;
            }
            const normalX = -(endY - startY) / length;
            const normalY = (endX - startX) / length;
            const innerHalfWidth = 0.3 + this._intensity * 0.25;
            const outerHalfWidth = 1.3 + this._intensity * 1.9;
            this._strokeColor.set(
                LINE_COLOR.r,
                LINE_COLOR.g,
                LINE_COLOR.b,
                Math.round((40 + travel * 115) * this._intensity),
            );
            graphics.fillColor = this._strokeColor;
            graphics.moveTo(startX + normalX * innerHalfWidth, startY + normalY * innerHalfWidth);
            graphics.lineTo(endX + normalX * outerHalfWidth, endY + normalY * outerHalfWidth);
            graphics.lineTo(endX - normalX * outerHalfWidth, endY - normalY * outerHalfWidth);
            graphics.lineTo(startX - normalX * innerHalfWidth, startY - normalY * innerHalfWidth);
            graphics.fill();
        }
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function rayScreenEdgeScale(
    originX: number,
    originY: number,
    directionX: number,
    directionY: number,
    halfWidth: number,
    halfHeight: number,
): number {
    const xScale = directionX >= 0
        ? (halfWidth - originX) / Math.max(0.001, directionX)
        : (-halfWidth - originX) / Math.min(-0.001, directionX);
    const yScale = directionY >= 0
        ? (halfHeight - originY) / Math.max(0.001, directionY)
        : (-halfHeight - originY) / Math.min(-0.001, directionY);
    return Math.max(0.01, Math.min(xScale, yScale));
}