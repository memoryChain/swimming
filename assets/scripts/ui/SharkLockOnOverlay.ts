import { Camera, Color, game, Graphics, Node, UITransform, Vec3 } from 'cc';
import type { SharkController } from '../entity/SharkController';
import { SharkState } from '../entity/SharkTuning';
import { makeUiNode } from './RuntimeUiFactory';

const MARKER_SIZE = 42;
const UPDATE_INTERVAL_MS = 34;

// Static Graphics is built exactly once. Projection and transform writes are
// throttled to 30Hz and skipped entirely while no shark target exists.
export class SharkLockOnOverlay {
    private _hud: Node | null = null;
    private _root: Node | null = null;
    private _marker: Node | null = null;
    private _lastSampleMs = 0;
    private readonly _world = new Vec3();
    private readonly _screen = new Vec3();
    private readonly _uiWorld = new Vec3();
    private readonly _uiLocal = new Vec3();

    bind(hud: Node): void {
        if (this._root?.isValid || !hud?.isValid) return;
        this._hud = hud;
        const root = makeUiNode('SharkLockOnOverlay', hud);
        const marker = makeUiNode('Marker', root);
        marker.getComponent(UITransform)!.setContentSize(MARKER_SIZE, MARKER_SIZE);
        const gfx = marker.addComponent(Graphics);
        const half = MARKER_SIZE * 0.5;
        gfx.moveTo(-half, half * 0.5);
        gfx.lineTo(half, half * 0.5);
        gfx.lineTo(0, -half * 0.65);
        gfx.fillColor = new Color(255, 64, 64, 255);
        gfx.fill();
        gfx.strokeColor = new Color(12, 18, 28, 235);
        gfx.lineWidth = 3;
        gfx.stroke();
        this._root = root;
        this._marker = marker;
        root.active = false;
    }

    update(shark: SharkController | null, worldCamera: Camera | null, uiCamera: Camera | null): void {
        const root = this._root;
        const target = shark?.target ?? null;
        const active = !!target && (shark?.state === SharkState.WARNING || shark?.state === SharkState.HUNT);
        if (!root?.isValid || !active || !worldCamera || !uiCamera || !target?.node.activeInHierarchy) {
            if (root?.active) root.active = false;
            return;
        }
        const now = game.totalTime;
        if (now - this._lastSampleMs < UPDATE_INTERVAL_MS) return;
        this._lastSampleMs = now;
        target.getCameraUpperBodyWorldPosition(this._world);
        worldCamera.worldToScreen(this._world, this._screen);
        uiCamera.screenToWorld(this._screen, this._uiWorld);
        this._hud!.getComponent(UITransform)!.convertToNodeSpaceAR(this._uiWorld, this._uiLocal);
        if (!root.active) root.active = true;
        root.setPosition(Math.round(this._uiLocal.x), Math.round(this._uiLocal.y + 46), 0);
        const pulse = 1 + 0.12 * Math.sin(now * 0.009);
        this._marker!.setScale(pulse, pulse, 1);
    }

    hide(): void {
        if (this._root?.active) this._root.active = false;
    }
}
