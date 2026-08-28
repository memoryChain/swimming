import { Camera, Color, Label, Node, UITransform, Vec3, view } from 'cc';
import type { Swimmer } from '../entity/Swimmer';
import { makeUiNode } from './RuntimeUiFactory';

const TAG_WIDTH = 128;
const TAG_HEIGHT = 24;
const HEAD_OFFSET_Y = 30;
const OFF_SCREEN_MARGIN = 48;
const OVERLAP_X = 76;
const OVERLAP_Y = 22;
const NAME_REFERENCE_DISTANCE = 10;
const NAME_MIN_SCALE = 0.48;
const NAME_MAX_SCALE = 1.05;
const NAME_SCALE_STEP = 0.02;
const AI_COLOR = new Color(245, 250, 255, 255);
const OUTLINE_COLOR = new Color(5, 14, 24, 225);

type NameEntry = {
    swimmer: Swimmer;
    root: Node;
    x: number;
    y: number;
    scale: number;
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
    private readonly _placedWidths: number[] = [];
    private readonly _placedHeights: number[] = [];
    private _anchorWarmupFrames = 0;

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
            tag.active = false;
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
            this._entries.push({ swimmer, root: tag, x: Number.NaN, y: Number.NaN, scale: -1 });
        }
        this.resetTracking();
    }

    setVisible(visible: boolean) {
        if (this._root?.isValid && this._root.active !== visible) {
            this._root.active = visible;
            if (visible) {
                this.resetTracking();
            }
        }
    }

    // A rematch can pass AWARDS -> READY -> PRECOUNTDOWN between two rendered
    // frames, so visibility never gets an edge and the old finish-line positions
    // would remain on screen. Hide cached tags for one frame while the swimmer
    // rig applies its new standing pose, then project the refreshed head bones.
    resetTracking() {
        this._anchorWarmupFrames = 1;
        for (const entry of this._entries) {
            entry.x = Number.NaN;
            entry.y = Number.NaN;
            entry.scale = -1;
            if (entry.root?.isValid && entry.root.active) {
                entry.root.active = false;
            }
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
        if (this._anchorWarmupFrames > 0) {
            this._anchorWarmupFrames--;
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
        this._placedWidths.length = 0;
        this._placedHeights.length = 0;

        for (const entry of this._entries) {
            const swimmerNode = entry.swimmer?.node;
            if (!entry.root?.isValid || !swimmerNode?.isValid || !swimmerNode.activeInHierarchy
                || (!showFinished && entry.swimmer.distance >= finishDistance)) {
                if (entry.root?.isValid && entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }
            entry.swimmer.getNameTagWorldPosition(this._worldPos);
            Vec3.subtract(this._cameraToHead, this._worldPos, worldCamera.node.worldPosition);
            if (Vec3.dot(this._cameraToHead, this._cameraForward) <= 0) {
                if (entry.root.active) {
                    entry.root.active = false;
                }
                continue;
            }

            const cameraDistance = Math.max(0.01, this._cameraToHead.length());
            const labelScale = swimmerHudScaleForDistance(cameraDistance);
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
            let y = Math.round(this._uiLocal.y + headOffsetY * labelScale);
            const collisionWidth = OVERLAP_X * labelScale;
            const collisionHeight = OVERLAP_Y * labelScale;
            for (let guard = 0; guard < this._entries.length; guard++) {
                let collided = false;
                for (let i = 0; i < this._placedX.length; i++) {
                    const overlapWidth = (this._placedWidths[i] + collisionWidth) * 0.5;
                    const overlapHeight = (this._placedHeights[i] + collisionHeight) * 0.5;
                    if (Math.abs(this._placedX[i] - x) < overlapWidth && Math.abs(this._placedY[i] - y) < overlapHeight) {
                        y = Math.round(this._placedY[i] + overlapHeight);
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
            this._placedWidths.push(collisionWidth);
            this._placedHeights.push(collisionHeight);
            if (!entry.root.active) {
                entry.root.active = true;
            }
            if (entry.scale !== labelScale) {
                entry.scale = labelScale;
                entry.root.setScale(labelScale, labelScale, 1);
            }
            if (entry.x !== x || entry.y !== y) {
                entry.x = x;
                entry.y = y;
                entry.root.setPosition(x, y, 0);
            }
        }
    }
}

// Shared by AI name tags and the player's overhead marker so both retain the
// same visual hierarchy as broadcast cameras pull in and out.
export function swimmerHudScaleForDistance(cameraDistance: number): number {
    const rawScale = Math.max(
        NAME_MIN_SCALE,
        Math.min(NAME_MAX_SCALE, Math.sqrt(NAME_REFERENCE_DISTANCE / Math.max(0.01, cameraDistance))),
    );
    return Math.round(rawScale / NAME_SCALE_STEP) * NAME_SCALE_STEP;
}

function fitName(value: string): string {
    const name = value || 'AI';
    return name.length > 8 ? `${name.slice(0, 8)}…` : name;
}
