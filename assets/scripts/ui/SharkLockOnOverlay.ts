import { Camera, Color, game, Graphics, Node, UIOpacity, UITransform, Vec3 } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import type { SharkController } from '../entity/SharkController';
import { SharkState } from '../entity/SharkTuning';
import { makeUiNode } from './RuntimeUiFactory';

const MARKER_SIZE = 44;
const HEAD_OFFSET_Y = 48;

// Red downward chevron pinned above the shark's current target's head while the
// shark is warning/hunting. Tells the hunted swimmer "it's coming for you - run".
// Reuses the same world -> screen -> HUD projection path as SwimmerNameOverlay.
export class SharkLockOnOverlay {
    private _hud: Node | null = null;
    private _root: Node | null = null;
    private _marker: Node | null = null;
    private _opacity: UIOpacity | null = null;
    private readonly _worldPos = new Vec3();
    private readonly _screenPos = new Vec3();
    private readonly _uiWorld = new Vec3();
    private readonly _uiLocal = new Vec3();
    private readonly _cameraForward = new Vec3();
    private readonly _cameraToHead = new Vec3();

    bind(hud: Node) {
        if (!hud?.isValid) {
            return;
        }
        this._hud = hud;
        if (this._root?.isValid) {
            return;
        }
        this._root = makeUiNode('SharkLockOn', hud);
        this._root.active = false;
        this._marker = makeUiNode('Marker', this._root);
        this._marker.getComponent(UITransform)!.setContentSize(MARKER_SIZE, MARKER_SIZE);
        drawChevron(this._marker.addComponent(Graphics));
        this._opacity = this._root.addComponent(UIOpacity);
        this._opacity.opacity = 255;
    }

    // Project the shark's target head to screen each frame and place the chevron
    // above it. Self-hides when the shark is not actively hunting a target.
    update(shark: SharkController | null, worldCamera: Camera | null, uiCamera: Camera | null) {
        if (!this._root?.isValid || !this._marker) {
            return;
        }

        const target = shark?.target ?? null;
        const active = !!shark
            && (shark.state === SharkState.WARNING || shark.state === SharkState.HUNT)
            && !!target;

        if (!active || !target || !worldCamera || !uiCamera) {
            this._root.active = false;
            return;
        }

        const swimmerNode = target.node;
        if (!swimmerNode?.isValid || !swimmerNode.activeInHierarchy) {
            this._root.active = false;
            return;
        }

        target.getCameraUpperBodyWorldPosition(this._worldPos);
        Vec3.subtract(this._cameraToHead, this._worldPos, worldCamera.node.worldPosition);
        Vec3.transformQuat(this._cameraForward, Vec3.FORWARD, worldCamera.node.worldRotation);
        if (Vec3.dot(this._cameraToHead, this._cameraForward) <= 0) {
            // Target behind the camera.
            this._root.active = false;
            return;
        }
        worldCamera.worldToScreen(this._worldPos, this._screenPos);
        uiCamera.screenToWorld(this._screenPos, this._uiWorld);
        const hudTransform = this._hud!.getComponent(UITransform)!;
        hudTransform.convertToNodeSpaceAR(this._uiWorld, this._uiLocal);

        this._root.active = true;
        this._root.setPosition(this._uiLocal.x, this._uiLocal.y + HEAD_OFFSET_Y, 0);
        // Steady heartbeat pulse driven by global time (no per-frame tween churn).
        const t = game.totalTime * 0.001;
        const pulse = 1 + 0.13 * Math.sin(t * 9);
        this._marker.setScale(pulse, pulse, 1);
    }
}

function drawChevron(g: Graphics) {
    g.clear();
    const s = MARKER_SIZE * 0.5;
    // Downward-pointing triangle (points at the hunted swimmer's head).
    g.moveTo(-s, s * 0.55);
    g.lineTo(s, s * 0.55);
    g.lineTo(0, -s * 0.6);
    g.fillColor = new Color(255, 70, 70, 255);
    g.fill();
    g.strokeColor = new Color(8, 12, 20, 235);
    g.lineWidth = 3;
    g.stroke();
}
