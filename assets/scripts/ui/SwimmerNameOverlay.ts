import { Camera, Color, Label, Node, UITransform, Vec3, view } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import { makeUiNode } from './RuntimeUiFactory';

const TAG_WIDTH = 128;
const TAG_HEIGHT = 24;
const HEAD_OFFSET_Y = 30;
const OFF_SCREEN_MARGIN = 48;
const OVERLAP_X = 76;
const OVERLAP_Y = 22;
const AI_COLOR = new Color(245, 250, 255, 255);
const OUTLINE_COLOR = new Color(5, 14, 24, 225);

type NameEntry = {
    swimmer: Swimmer;
    root: Node;
    x: number;
    y: number;
};

// Lightweight race-time name tags. They reuse the same world -> screen -> HUD
// projection path as the finish badges, but deliberately render only outlined
// text so the labels stay quiet while the player is swimming.
export class SwimmerNameOverlay {
    private _hud: Node | null = null;
    private _root: Node | null = null;
    private readonly _entries: NameEntry[] = [];
    private readonly _worldPos = new Vec3();
    private readonly _screenPos = new Vec3();
    private readonly _uiWorld = new Vec3();
    private readonly _uiLocal = new Vec3();
    private readonly _cameraForward = new Vec3();
    private readonly _cameraToHead = new Vec3();
    private readonly _placedX: number[] = [];
    private readonly _placedY: number[] = [];

    bind(hud: Node) {
        if (!hud?.isValid) {
            return;
        }
        this._hud = hud;
        if (!this._root?.isValid) {
            this._root = makeUiNode('SwimmerNameTags', hud);
            this._root.active = false;
        }
    }

    setSwimmers(swimmers: readonly Swimmer[], player: Swimmer | null) {
        if (!this._root?.isValid) {
            return;
        }
        this._root.destroyAllChildren();
        this._entries.length = 0;
        for (const swimmer of swimmers) {
            // The protagonist already has a red overhead triangle, so only AI
            // opponents need race-time name labels.
            if (!swimmer?.node?.isValid || swimmer === player) {
                continue;
            }
            const tag = makeUiNode(`SwimmerName_${swimmer.node.name}`, this._root);
            tag.getComponent(UITransform)!.setContentSize(TAG_WIDTH, TAG_HEIGHT);
            const label = tag.addComponent(Label);
            label.string = fitName(swimmer.swimmerName);
            label.fontSize = 15;
            label.lineHeight = TAG_HEIGHT;
            label.color = AI_COLOR;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            label.overflow = Label.Overflow.SHRINK;
            label.enableOutline = true;
            label.outlineColor = OUTLINE_COLOR;
            label.outlineWidth = 2;
            this._entries.push({ swimmer, root: tag, x: Number.NaN, y: Number.NaN });
        }
    }

    setVisible(visible: boolean) {
        if (this._root?.isValid && this._root.active !== visible) {
            this._root.active = visible;
        }
    }

    update(
        worldCamera: Camera | null,
        uiCamera: Camera | null,
        finishDistance: number,
        showFinished = false,
        headOffsetY = HEAD_OFFSET_Y,
    ) {
        if (!this._root?.isValid || !this._root.active || !this._hud?.isValid || !worldCamera || !uiCamera) {
            return;
        }
        const hudTransform = this._hud.getComponent(UITransform);
        if (!hudTransform) {
            return;
        }
        const visibleSize = view.getVisibleSize();
        const halfWidth = (hudTransform.width || visibleSize.width) / 2 + OFF_SCREEN_MARGIN;
        const halfHeight = (hudTransform.height || visibleSize.height) / 2 + OFF_SCREEN_MARGIN;
        Vec3.transformQuat(this._cameraForward, Vec3.FORWARD, worldCamera.node.worldRotation);
        this._placedX.length = 0;
        this._placedY.length = 0;

        for (const entry of this._entries) {
            const swimmerNode = entry.swimmer?.node;
            if (!entry.root?.isValid || !swimmerNode?.isValid || !swimmerNode.activeInHierarchy
                || (!showFinished && entry.swimmer.distance >= finishDistance)) {
                if (entry.root?.isValid && entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }
            entry.swimmer.getCameraUpperBodyWorldPosition(this._worldPos);
            Vec3.subtract(this._cameraToHead, this._worldPos, worldCamera.node.worldPosition);
            if (Vec3.dot(this._cameraToHead, this._cameraForward) <= 0) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }
            worldCamera.worldToScreen(this._worldPos, this._screenPos);
            uiCamera.screenToWorld(this._screenPos, this._uiWorld);
            hudTransform.convertToNodeSpaceAR(this._uiWorld, this._uiLocal);
            if (Math.abs(this._uiLocal.x) > halfWidth || Math.abs(this._uiLocal.y) > halfHeight) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }

            const x = Math.round(this._uiLocal.x);
            let y = Math.round(this._uiLocal.y + headOffsetY);
            for (let guard = 0; guard < this._entries.length; guard++) {
                let collided = false;
                for (let i = 0; i < this._placedX.length; i++) {
                    if (Math.abs(this._placedX[i] - x) < OVERLAP_X && Math.abs(this._placedY[i] - y) < OVERLAP_Y) {
                        y = this._placedY[i] + OVERLAP_Y;
                        collided = true;
                        break;
                    }
                }
                if (!collided) {
                    break;
                }
            }
            this._placedX.push(x);
            this._placedY.push(y);
            if (!entry.root.active) {
                entry.root.active = true;
            }
            if (entry.x !== x || entry.y !== y) {
                entry.x = x;
                entry.y = y;
                entry.root.setPosition(x, y, 0);
            }
        }
    }
}

function fitName(value: string): string {
    const name = value || 'AI';
    return name.length > 8 ? `${name.slice(0, 8)}…` : name;
}
